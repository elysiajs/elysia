import { env } from '../universal'
import { nullObject } from '../utils'
import packageJson from '../../package.json'
import type { CoercePlan } from '../type/coerce'

export const AOT_MANIFEST_FORMAT = 3
export const AOT_ABI = `${packageJson.version}:${AOT_MANIFEST_FORMAT}`

export interface AotFingerprint {
	abi: string
}

export interface ProgramId {
	readonly _: unique symbol
}

export const createProgramId = (): ProgramId => ({}) as ProgramId

export function createAotFingerprint(): AotFingerprint {
	return { abi: AOT_ABI }
}

export interface CompilerSession {
	readonly sucroseCache: Map<
		string,
		{ content: string; inference: unknown; bytes: number }
	>
	sucroseCacheBytes: number
	capture?: Map<string, CapturedValidator>
	handlerCapture?: Map<string, CapturedHandler>
	app?: object
	external?: true
	explicitCapture?: true
}

let activeSession: CompilerSession | undefined

const newCompilerSession = (): CompilerSession => ({
	sucroseCache: new Map(),
	sucroseCacheBytes: 0
})

export function beginCompilerSession(app: object): CompilerSession {
	const session = activeSession ?? (activeSession = newCompilerSession())
	if (env.ELYSIA_AOT_BUILD && !session.external) {
		session.external = true
		session.capture = new Map()
	}

	if (session.app && session.app !== app)
		throw new Error('[Elysia] Another compiler session is already active.')

	session.app = app
	;(app as { ['~compilerSession']?: CompilerSession })['~compilerSession'] =
		session

	return session
}

export function endCompilerSession(
	app: object,
	session: CompilerSession,
	failed = false
) {
	const holder = app as { ['~compilerSession']?: CompilerSession }
	if (holder['~compilerSession'] === session)
		delete holder['~compilerSession']

	if (session.app === app) session.app = undefined
	if (session.external && (!failed || session.explicitCapture)) return

	session.sucroseCache.clear()
	session.sucroseCacheBytes = 0
	session.capture = undefined
	session.handlerCapture = undefined
	if (activeSession === session) activeSession = undefined
}

export const getCompilerSession = () => activeSession

export type ValidatorSlot =
	| 'body'
	| 'query'
	| 'params'
	| 'headers'
	| 'cookie'
	| `response:${number}`

export type FrozenCheckFactory = (
	External: unknown
) => (value: unknown) => boolean

export type FrozenMirrorFactory = (
	deps?: unknown
) => (value: unknown) => unknown

export interface FrozenMirror {
	/**
	 * Without `u`: `(v) => cleaned` directly
	 * With `u`: `({ unions }) => (v) => cleaned`
	 */
	s: FrozenMirrorFactory | ((value: unknown) => unknown)
	// unions (`u[ui][i]`)
	u?: FrozenCheckFactory[][]
}

export type FrozenBothFactory = (
	External: unknown,
	// `d` (`{ unions }` built from the entry's `u`) feeds the mirror
	d: unknown
) => {
	check?: (value: unknown) => boolean
	clean?: (value: unknown) => unknown
}

export interface FrozenValidator {
	/** The check factory. Absent → the check JITs (only the mirror was frozen). */
	c?: FrozenCheckFactory
	// exact-mirror clean
	m?: FrozenMirror
	// decode mirror
	// `{ unions, codecs }`: codecs rebuilt from the live schema's `~codec.decode`
	dm?: FrozenMirror
	// encode mirror
	em?: FrozenMirror
	/** Merged check + clean (present iff a slot froze BOTH; supersedes `c`/`m`). */
	cm?: FrozenBothFactory
	/** Union branch checks for the merged mirror (entry-level `m.u`). */
	u?: FrozenCheckFactory[][]
	// TypeBox Externals, eg. Refine
	e?: 1
	// isAsync
	a?: 1
	// hasDefault
	d?: 1
	// hasCodec
	k?: 1
	// hasRef
	r?: 1
	// precompute-safe
	ps?: 1
	// precomputed default for absent input (`Default(schema, undefined)`)
	pd?: unknown
	// precomputed default also applies to explicit `null`
	pn?: 1
	// precomputed object-default template (`Default(schema, {})`)
	pod?: Record<string, unknown>
	// generated cloner for `pd`
	dc?: () => unknown
	// generated merger for `pod`
	pm?: (value: Record<string, unknown>) => Record<string, unknown>
	// custom error
	ce?: Array<{ p: string; c: FrozenCheckFactory; e?: 1 }>
	// inner codec
	ic?: Array<{
		o: number
		c: FrozenCheckFactory
		e?: 1
		// `x:1` → decode `s` is a (d)=>(v) factory (inner has codecs/unions);
		// otherwise `s` is a plain (v)=>cleaned cleaner called directly
		d: FrozenMirror & { x?: 1 }
	}>
	cp?: CoercePlan
}

export interface ValidatorManifest {
	[method: string]: {
		[path: string]: Partial<Record<ValidatorSlot, FrozenValidator>>
	}
}

// compiled handler
//
// @see `src/compile/handler/index.ts`
export interface FrozenHandler {
	// positional parameter eg. pf,pj
	a: string[]
	// Handler factory: `(h, ...params) => composedHandler`
	f: (...deps: unknown[]) => unknown
}

export interface HandlerManifest {
	[method: string]: {
		[path: string]: FrozenHandler
	}
}

export interface CompiledSnapshot {
	registered: CompiledProgramRegistration | undefined
	claimed: boolean
	programs: WeakMap<ProgramId, CompiledProgram>
}

export interface CompiledProgramRegistration {
	bf: 1
	fingerprint: AotFingerprint
	validators?: ValidatorManifest
	handlers?: HandlerManifest
	lazyGroups?: Array<() => ValidatorManifest>
	lazyGroupOf?: Record<string, Record<string, number>>
	planRebuilder?: (original: unknown, plan: CoercePlan) => any
}

interface CompiledProgram extends CompiledProgramRegistration {
	builtGroups: Set<number>
}

/**
 * Frozen-manifest reconstruction table (implemented in `aot-reconstruct.ts`).
 *
 * Runtime frozen paths reach it through `reconstruct()` instead of importing
 * the impls, so apps that never register a manifest tree-shake them
 *
 * The generated manifest module installs it (`Compiled.reconstruct = Reconstruct`)
 * before any frozen entry can be observed.
 */
export interface ReconstructImpl {
	collectExternals(schema: any, out?: unknown[]): unknown[]
	collectMirrorUnions(schema: any, out?: unknown[][]): unknown[][]
	collectStringCodecNodes(
		schema: any,
		out?: StringCodecNode[]
	): StringCodecNode[]
	instantiateFrozenMirror(
		frozen: FrozenMirror,
		schema: unknown
	): (value: unknown) => unknown
	instantiateFrozenDecodeMirror(
		frozen: FrozenMirror,
		schema: unknown,
		dir?: 'decode' | 'encode'
	): (value: unknown) => unknown
	instantiateFrozenBoth(
		frozen: FrozenValidator,
		checkSchema: unknown,
		mirrorSchema: unknown
	): {
		check?: (value: unknown) => boolean
		clean?: (value: unknown) => unknown
	}
	reconstructInnerCodecs(
		ic: NonNullable<FrozenValidator['ic']>,
		schema: any
	): void
}

let reconstructImpl: ReconstructImpl | undefined

const reconstructActivationError = new Error(
	'Elysia AOT reconstruct module is not activated.'
)

export function reconstruct(): ReconstructImpl {
	if (reconstructImpl === undefined) throw reconstructActivationError

	return reconstructImpl
}

// build registry
let registered: CompiledProgramRegistration | undefined
let claimed = false
let programs = new WeakMap<ProgramId, CompiledProgram>()

const programFor = (id?: ProgramId) => (id ? programs.get(id) : undefined)

const fingerprintMismatch = (
	manifest: CompiledProgramRegistration,
	actual: AotFingerprint
) => {
	const differences: string[] = []
	const expected = manifest.fingerprint

	if (manifest.bf !== 1)
		differences.push(`bf (manifest ${manifest.bf}, app 1)`)
	if (expected.abi !== actual.abi)
		differences.push(`abi (manifest ${expected.abi}, app ${actual.abi})`)

	return differences
}

export abstract class Compiled {
	static register(manifest: CompiledProgramRegistration) {
		registered = manifest
		claimed = false
	}

	static claim(id: ProgramId, fingerprint: AotFingerprint): boolean {
		if (!registered || claimed) return false

		const manifest = registered
		const differences = fingerprintMismatch(manifest, fingerprint)
		if (differences.length)
			throw new Error(
				`[elysia-aot] Registered manifest fingerprint mismatch: ${differences.join('; ')}.`
			)

		claimed = true
		registered = undefined
		programs.set(id, {
			...manifest,
			builtGroups: new Set()
		})
		return true
	}

	static get reconstruct(): ReconstructImpl | undefined {
		return reconstructImpl
	}

	static set reconstruct(impl: ReconstructImpl | undefined) {
		reconstructImpl = impl
	}

	static getHandler(
		id: ProgramId | undefined,
		method: string,
		path: string
	): FrozenHandler | undefined {
		return programFor(id)?.handlers?.[method]?.[path]
	}

	static getValidator(
		method: string,
		path: string,
		slot: ValidatorSlot,
		id?: ProgramId
	): FrozenValidator | undefined {
		const program = programFor(id)
		if (!program) return undefined

		let programValidators = program.validators
		let e = programValidators?.[method]?.[path]?.[slot]
		if (e !== undefined || !program.lazyGroupOf) return e

		const g = program.lazyGroupOf[method]?.[path]
		if (g !== undefined && !program.builtGroups.has(g)) {
			program.builtGroups.add(g)
			const slice = program.lazyGroups![g]!()

			programValidators ??= program.validators =
				nullObject() as ValidatorManifest

			for (const m in slice) {
				const into = (programValidators[m] ??= nullObject() as any)
				Object.assign(into, slice[m])
			}

			e = programValidators?.[method]?.[path]?.[slot]
		}

		return e
	}

	static hasValidator(
		method: string,
		path: string,
		slot: ValidatorSlot,
		id?: ProgramId
	) {
		const program = programFor(id)
		if (!program) return false

		return (
			program.validators?.[method]?.[path]?.[slot] !== undefined ||
			program.lazyGroupOf?.[method]?.[path] !== undefined
		)
	}

	static getPlanRebuilder(id?: ProgramId) {
		return programFor(id)?.planRebuilder
	}

	static release(id: ProgramId | undefined): boolean {
		return id ? programs.delete(id) : false
	}

	/** @internal test isolation */
	static clear() {
		registered = undefined
		claimed = false
		programs = new WeakMap()
	}
}

/**
 * @internal build/test-only state access for the capture module
 * (`aot-capture.ts`): session teardown/reentrancy + registry snapshot.
 */
export const CompilerState = {
	get session() {
		return activeSession
	},
	set session(session: CompilerSession | undefined) {
		activeSession = session
	},
	newSession: newCompilerSession,
	get registry(): CompiledSnapshot {
		return { registered, claimed, programs }
	},
	set registry(snapshot: CompiledSnapshot) {
		registered = snapshot.registered
		claimed = snapshot.claimed
		programs = snapshot.programs
	}
}

// mirrors TypeBox's internal CreateCode
export interface CheckBuildResult {
	functions: string[]
	entry: string
	useUnevaluated: boolean
	external: { identifier: string; variables: unknown[] }
}

export const EMPTY_EXTERNALS = Object.freeze([]) as unknown as unknown[]

// `ic[i]` in a frozen validator aligns 1:1 with the ObjectString/ArrayString
// nodes `collectStringCodecNodes` (aot-reconstruct.ts) walks off the schema
export interface StringCodecNode {
	inner: any
	codec: any
	open: number
}

export interface CapturedMirror {
	source: string
	hasExternals: boolean
	// unions
	u?: { identifier: string; code: string }[][]
}

export interface CapturedValidator {
	method: string
	path: string
	slot: ValidatorSlot
	// Check: `External` identifier + `reconstructCheck(buildResult)` (defs/value
	identifier?: string
	checkDefs?: string
	checkValue?: string
	// from `collectExternals`
	external?: boolean
	async?: boolean
	hasDefault?: boolean
	hasCodec?: boolean
	hasRef?: boolean
	mirror?: CapturedMirror
	// request-side decode mirror (codec `~decode`), frozen to `dm`
	decodeMirror?: CapturedMirror
	// response-side encode mirror (codec `~encode`), frozen to `em`
	encodeMirror?: CapturedMirror
	// preallocated defaults (build-verified), frozen to `ps`/`pd`/`pod`
	precomputeSafe?: boolean
	precomputedDefault?: unknown
	precomputeNull?: boolean
	precomputedObjectDefault?: Record<string, unknown>
	defaultCloner?: string
	objectDefaultMerger?: string
	// per-field custom-error checks, frozen to `ce`
	customErrors?: Array<{
		path: string
		identifier: string
		checkDefs: string
		checkValue: string
		external: boolean
	}>
	// inner codecs (t.ObjectString / t.ArrayString) frozen to `ic`
	innerCodecs?: Array<{
		open: number
		identifier: string
		checkDefs: string
		checkValue: string
		external: boolean
		decode: CapturedMirror
	}>
	// coercion plan (primitive coercions)
	coercePlan?: CoercePlan
	// Use to gate a `setupTypebox` stub.
	// Set at capture time by `frozen-validator.isCapturedBridgeFree`.
	bridgeFree?: boolean
}

function captureEntry({
	method,
	path,
	slot
}: {
	method: string
	path: string
	slot: ValidatorSlot
}) {
	if (!isValidatorCapturing()) return

	const capture = activeSession?.capture
	if (!capture) return

	const k = `${method}_${path}_${slot}`

	let e = capture.get(k)
	if (!e) capture.set(k, (e = { method, path, slot }))

	return e
}

/** @internal shared with `aot-capture.ts` (`beginValidatorCapture`). */
export const aotActivationError = new Error(
	'Elysia AOT capture module is not activated.'
)

export interface CapturedHandler {
	method: string
	path: string
	alias: string
	code: string
}

function captureHandler(v: CapturedHandler) {
	if (!isValidatorCapturing()) return

	const session = activeSession
	if (!session) return
	;(session.handlerCapture ??= new Map()).set(`${v.method}\0${v.path}`, v)
}

function captureSet(
	loc: { method: string; path: string; slot: ValidatorSlot },
	partial: Partial<CapturedValidator>
) {
	const e = captureEntry(loc)
	if (e) Object.assign(e, partial)
}

const captureGet = (loc: {
	method: string
	path: string
	slot: ValidatorSlot
}) => activeSession?.capture?.get(`${loc.method}_${loc.path}_${loc.slot}`)

const isAotBuildEnv = () => !!env.ELYSIA_AOT_BUILD

const isValidatorCapturing = (): boolean => {
	if (activeSession?.capture !== undefined) {
		if (captureImpl === undefined) throw aotActivationError

		return true
	}

	if (isAotBuildEnv()) {
		if (captureImpl === undefined) throw aotActivationError

		return true
	}

	return false
}

export const Capture = {
	set: captureSet,
	get: captureGet,
	handler: captureHandler,
	isCapturing: isValidatorCapturing,
	isAotBuildEnv: isAotBuildEnv
} as const

// build-only capture logic
export interface CaptureImpl {
	/** Source-only TypeBox validator (retains codegen source for the manifest). */
	sourceOnlyValidator(schema: any): any

	/**
	 * Capture the frozen check + defaults + custom-errors + inner-codecs + coerce
	 * plan for a validator slot. Mirrors the former `#maybeCapture`.
	 */
	maybeCapture(args: {
		aot: { method: string; path: string }
		slot: ValidatorSlot
		hasRef: boolean
		originalSchema: any
		schema: any
		hasCodec: boolean
		hasDefault: boolean
		coerces: unknown
		normalize: boolean | 'exactMirror' | 'typebox' | undefined
		sanitize: unknown
		buildResult: CheckBuildResult
	}): void

	/** Capture the exact-mirror clean emit for a slot (former `#setupMirror`). */
	captureMirror(
		schema: any,
		aot: { method: string; path: string },
		slot: ValidatorSlot,
		sanitize: unknown
	): void

	/** Capture the codec decode/encode mirror emit (former `#setupCodecMirror`). */
	captureCodecMirror(
		schema: any,
		aot: { method: string; path: string },
		slot: ValidatorSlot,
		sanitize: unknown,
		dir: 'decode' | 'encode'
	): void

	/** Derive + store the bridge-free marker once every channel is captured. */
	captureBridgeFree(
		aot: { method: string; path: string },
		slot: ValidatorSlot,
		rawSchema: unknown
	): void
}

/** Installed by the AOT build plugin; undefined at runtime. */
export let captureImpl: CaptureImpl | undefined

export function setCaptureImpl(impl: CaptureImpl | undefined) {
	captureImpl = impl
}
