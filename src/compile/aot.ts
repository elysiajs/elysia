import { env } from '../universal'
import packageJson from '../../package.json'
import type { CoercePlan } from '../type/coerce'
import type {
	AppPlanAotPayload,
	AppPlanAotValidatorManifest,
	AppPlanAotWSManifest
} from './app-plan-aot'

export const AOT_MANIFEST_FORMAT = 7
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
	wsCapture?: Map<string, CapturedWSRoute>
	captureRoutes?: Set<string>
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
		session.captureRoutes = new Set()
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
	session.wsCapture = undefined
	session.captureRoutes = undefined
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

export type WSBindingRole = string

export interface FrozenWSRoute {
	a: readonly WSBindingRole[]
	f: (...args: unknown[]) => unknown
}

export interface WSRouteManifest {
	[path: string]: FrozenWSRoute
}

export interface CompiledSnapshot {
	registered: CompiledProgramRegistration | undefined
}

export interface CompiledProgramRegistration {
	bf: 1
	fingerprint: AotFingerprint
	appPlan: {
		payload: AppPlanAotPayload
		validators: AppPlanAotValidatorManifest
		wsRoutes: AppPlanAotWSManifest
	}
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

export abstract class Compiled {
	static register(manifest: CompiledProgramRegistration) {
		if ('handlers' in (manifest as unknown as Record<string, unknown>))
			throw new Error('[elysia-aot] legacy handler manifests were removed')
		if ('planRebuilder' in (manifest as unknown as Record<string, unknown>))
			throw new Error('[elysia-aot] legacy planRebuilder layout was removed')
		if (!manifest.appPlan)
			throw new Error('[elysia-aot] direct AppPlan manifest is required')
		if (manifest.appPlan.payload?.format !== AOT_MANIFEST_FORMAT)
			throw new Error(
				`[elysia-aot] Unsupported AppPlan manifest format: ${String(manifest.appPlan.payload?.format)}.`
			)

		registered = manifest
	}

	/** @internal Inspect without exposing any keyed sidecar to a live app. */
	static pendingAppPlan(): CompiledProgramRegistration | undefined {
		return registered
	}

	/** @internal Commit only after the direct AppPlan binder validates the whole image. */
	static claimValidated(manifest: CompiledProgramRegistration): boolean {
		if (registered !== manifest) return false
		registered = undefined
		return true
	}

	static get reconstruct(): ReconstructImpl | undefined {
		return reconstructImpl
	}

	static set reconstruct(impl: ReconstructImpl | undefined) {
		reconstructImpl = impl
	}

	/** @internal test isolation */
	static clear() {
		registered = undefined
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
		return { registered }
	},
	set registry(snapshot: CompiledSnapshot) {
		registered = snapshot.registered
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

export type CapturedWSRoute =
	| {
			path: string
			roles: readonly WSBindingRole[]
			source: string
	  }
	| {
			path: string
			reason: string
	  }

function captureWSRoute(v: CapturedWSRoute) {
	if (!isValidatorCapturing()) return

	const session = activeSession
	if (!session) return
	;(session.wsCapture ??= new Map()).set(v.path, v)
}

function beginCaptureRoute(method: string, path: string) {
	const session = activeSession
	if (!session?.capture) return
	const route = `${method}\0${path}`
	const routes = (session.captureRoutes ??= new Set())
	if (!routes.has(route)) {
		routes.add(route)
		return
	}

	for (const [key, captured] of session.capture ?? [])
		if (captured.method === method && captured.path === path)
			session.capture!.delete(key)

	if (method === 'WS') session.wsCapture?.delete(path)
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
	beginRoute: beginCaptureRoute,
	ws: captureWSRoute,
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
