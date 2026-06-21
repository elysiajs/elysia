import { env } from '../universal'
import { nullObject } from '../utils'

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
	// precomputed object-default template (`Default(schema, {})`)
	pod?: Record<string, unknown>
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

// build registry
let validators: ValidatorManifest | undefined
let handlers: HandlerManifest | undefined

// lazy validator groups (sync thunks)
let lazyGroups: Array<() => ValidatorManifest> | undefined
let lazyGroupOf: Record<string, Record<string, number>> | undefined
const builtGroups = new Set<number>()

export abstract class Compiled {
	static get handlers(): HandlerManifest | undefined {
		return handlers
	}

	static set handlers(manifest: HandlerManifest) {
		handlers = manifest
	}

	static get validators(): ValidatorManifest | undefined {
		return validators
	}

	static set validators(manifest: ValidatorManifest) {
		validators = manifest
	}

	static registerLazyValidators(
		groups: Array<() => ValidatorManifest>,
		groupOf: Record<string, Record<string, number>>
	) {
		lazyGroups = groups
		lazyGroupOf = groupOf
		builtGroups.clear()
		validators ??= nullObject() as ValidatorManifest
	}

	static getValidator(
		method: string,
		path: string,
		slot: ValidatorSlot
	): FrozenValidator | undefined {
		let e = validators?.[method]?.[path]?.[slot]
		if (e !== undefined || !lazyGroupOf) return e

		const g = lazyGroupOf[method]?.[path]
		if (g !== undefined && !builtGroups.has(g)) {
			builtGroups.add(g)
			const slice = lazyGroups![g]!()
			for (const m in slice) {
				const into = (validators![m] ??= nullObject() as any)
				Object.assign(into, slice[m])
			}
			e = validators?.[method]?.[path]?.[slot]
		}
		return e
	}

	static hasValidator(
		method: string,
		path: string,
		slot: ValidatorSlot
	): boolean {
		return (
			validators?.[method]?.[path]?.[slot] !== undefined ||
			lazyGroupOf?.[method]?.[path] !== undefined
		)
	}

	/** @internal test isolation */
	static clear() {
		validators = undefined
		handlers = undefined
		lazyGroups = undefined
		lazyGroupOf = undefined
		builtGroups.clear()
	}
}

// mirrors TypeBox's internal CreateCode
export interface CheckBuildResult {
	functions: string[]
	entry: string
	useUnevaluated: boolean
	external: { identifier: string; variables: unknown[] }
}

export function reconstructCheck(build: CheckBuildResult): {
	defs: string
	value: string
} {
	const defs = build.functions.join(';\n')

	if (!build.useUnevaluated) {
		const single = /^([A-Za-z_$][\w$]*)\(value\)$/.exec(build.entry.trim())
		if (single) return { defs, value: single[1] }
	}

	const statements =
		(build.useUnevaluated
			? 'const context = new CheckContext({}, {});\n'
			: '') + `return ${build.entry}`

	return { defs, value: `(value) => { ${statements} }` }
}

const checkCode = (defs: string, value: string) => `${defs}; return ${value}`

function reconstructCheckCode(build: CheckBuildResult) {
	const { defs, value } = reconstructCheck(build)
	return checkCode(defs, value)
}

// emit into bundle for frozen check
const checkFactorySource = (identifier: string, code: string) =>
	`function(${identifier}){${code}}`

const handlerFactorySource = (alias: string, code: string) =>
	`function(h${alias ? ',' + alias : ''}){return ${code}}`

const isValueLikeExternal = (v: unknown) =>
	v === null || (typeof v !== 'object' && typeof v !== 'function')

/**
 * Rebuild TypeBox `External[]` for `schema` in `BuildSchema` traversal order:
 * object (patternProperties → properties) → array (items) → string (pattern) →
 * guard → const → enum → not/allOf/anyOf/oneOf → refine LAST.
 */
export function collectExternals(schema: any, out: unknown[] = []) {
	if (!schema || typeof schema !== 'object') return out

	const pp = schema.patternProperties
	if (pp)
		for (const pattern in pp) {
			out.push(new RegExp(pattern, 'u'))
			collectExternals(pp[pattern], out)
		}

	if (schema.properties)
		for (const k in schema.properties)
			collectExternals(schema.properties[k], out)

	const items = schema.items
	if (Array.isArray(items)) for (const it of items) collectExternals(it, out)
	else if (items) collectExternals(items, out)

	if (typeof schema.pattern === 'string')
		out.push(new RegExp(schema.pattern, 'u'))

	if (schema['~guard']) out.push(schema)

	if ('const' in schema && !isValueLikeExternal(schema.const))
		out.push(schema.const)

	if (Array.isArray(schema.enum))
		for (const o of schema.enum) if (!isValueLikeExternal(o)) out.push(o)

	if (schema.not) collectExternals(schema.not, out)
	if (Array.isArray(schema.allOf))
		for (const s of schema.allOf) collectExternals(s, out)
	if (Array.isArray(schema.anyOf))
		for (const s of schema.anyOf) collectExternals(s, out)
	if (Array.isArray(schema.oneOf))
		for (const s of schema.oneOf) collectExternals(s, out)

	if (schema['~refine']) out.push(schema['~refine'])

	return out
}

export function externalsMatch(a: unknown[], b: unknown[]) {
	if (a.length !== b.length) return false

	for (let i = 0; i < a.length; i++) {
		const x = a[i] as any
		const y = b[i] as any

		if (x === y) continue

		if (x instanceof RegExp && y instanceof RegExp) {
			if (x.source !== y.source || x.flags !== y.flags) return false
			continue
		}

		if (Array.isArray(x) && Array.isArray(y)) {
			if (x.length !== y.length) return false

			let ok = true
			for (let j = 0; j < x.length; j++)
				if (x[j] !== y[j]) {
					ok = false
					break
				}

			if (ok) continue
		}

		return false
	}

	return true
}

const mirrorFactorySource = (source: string, hasExternals: boolean) =>
	hasExternals
		? // union: a factory `(d) => (v) => cleaned`. `d` injects the branch checks
			`function(d){${source}}`
		: // plain: the cleaner `(v) => cleaned` directly (no unused-`d` factory)
			`function(v){${source}}`

// Merged check + mirror factory (cm)
const bothFactorySource = (
	identifier: string,
	checkDefs: string,
	checkValue: string,
	mirrorSource: string,
	mirrorHasExternals: boolean
) =>
	`function(${identifier},d){${checkDefs}; return{check:${checkValue},clean:${
		mirrorHasExternals
			? `(function(d){${mirrorSource}})(d)`
			: `function(v){${mirrorSource}}`
	}}}`

// ? Build-only: these source emitters are imported solely by `plugin/source.ts`
export const Source = {
	checkFactory: checkFactorySource,
	checkCode: checkCode,
	handlerFactory: handlerFactorySource,
	mirrorFactory: mirrorFactorySource,
	bothFactory: bothFactorySource
} as const

function collectMirrorUnions(schema: any, out: unknown[][] = []) {
	if (!schema || typeof schema !== 'object') return out

	if (schema.type === 'object' && schema.properties)
		for (const key in schema.properties)
			collectMirrorUnions(schema.properties[key], out)
	else if (schema.type === 'array' && schema.items) {
		if (Array.isArray(schema.items))
			for (const it of schema.items) collectMirrorUnions(it, out)
		else collectMirrorUnions(schema.items, out)
	} else if (Array.isArray(schema.anyOf)) {
		out.push(schema.anyOf)

		// exact-mirror mirrors EACH union branch twice
		// (the `if Check` return path + the clean-then-check fallback, index.mjs:166/172)
		// so a nested union inside a branch is enumerated twice in `instruction.unions`
		for (const b of schema.anyOf) {
			collectMirrorUnions(b, out)
			collectMirrorUnions(b, out)
		}
	}

	return out
}

function collectMirrorCodecs(
	schema: any,
	out: Function[] = [],
	dir: 'decode' | 'encode' = 'decode'
): Function[] {
	if (!schema || typeof schema !== 'object') return out

	const codec = schema['~codec']
	if (
		codec &&
		typeof codec[dir] === 'function' &&
		out.indexOf(codec[dir]) === -1
	)
		out.push(codec[dir])

	if (schema.type === 'object' && schema.properties)
		for (const key in schema.properties)
			collectMirrorCodecs(schema.properties[key], out, dir)
	else if (schema.type === 'array' && schema.items) {
		if (Array.isArray(schema.items))
			for (const it of schema.items) collectMirrorCodecs(it, out, dir)
		else collectMirrorCodecs(schema.items, out, dir)
	} else if (Array.isArray(schema.anyOf))
		for (const b of schema.anyOf) collectMirrorCodecs(b, out, dir)

	return out
}

// Rebuild exact-mirror's `d.unions` from live schema
function buildUnions(u: FrozenCheckFactory[][], schema: unknown) {
	const branchSchemas = collectMirrorUnions(schema)

	return u.map((branches, ui) =>
		branches.map((factory, i) => ({
			Check: factory(collectExternals(branchSchemas[ui]![i]))
		}))
	)
}

export function instantiateFrozenMirror(
	frozen: FrozenMirror,
	schema: unknown
): (value: unknown) => unknown {
	// Plain mirror: `s` is the cleaner itself (no factory wrapper to call).
	if (!frozen.u) return frozen.s as (value: unknown) => unknown

	return (frozen.s as FrozenMirrorFactory)({
		unions: buildUnions(frozen.u, schema)
	})
}

// Codec mirror: `d.codecs` are the live schema's `~codec.decode` (request) or
// `~codec.encode` (response) leaves; `d.unions` when the schema has unions.
export function instantiateFrozenDecodeMirror(
	frozen: FrozenMirror,
	schema: unknown,
	dir: 'decode' | 'encode' = 'decode'
): (value: unknown) => unknown {
	const d: { codecs: Function[]; unions?: unknown } = {
		codecs: collectMirrorCodecs(schema, [], dir)
	}

	if (frozen.u) d.unions = buildUnions(frozen.u, schema)

	return (frozen.s as FrozenMirrorFactory)(d)
}

export const instantiateFrozenEncodeMirror = (
	frozen: FrozenMirror,
	schema: unknown
): ((value: unknown) => unknown) =>
	instantiateFrozenDecodeMirror(frozen, schema, 'encode')

export const EMPTY_EXTERNALS = Object.freeze([]) as unknown as unknown[]

export function instantiateFrozenBoth(
	frozen: FrozenValidator,
	checkSchema: unknown,
	mirrorSchema: unknown
): {
	check?: (value: unknown) => boolean
	clean?: (value: unknown) => unknown
} {
	return frozen.cm!(
		frozen.e ? collectExternals(checkSchema) : EMPTY_EXTERNALS,
		frozen.u ? { unions: buildUnions(frozen.u, mirrorSchema) } : undefined
	)
}

/**
 * verify that mirror unions can be reconstructed in build time
 *
 * return undefined if not reconstructable
 * `truthUnions` is `mir.externals.unions` (compiled branches).
 */
function captureMirrorUnions(schema: unknown, truthUnions: any[][]) {
	const branchSchemas = collectMirrorUnions(schema)
	if (branchSchemas.length !== truthUnions.length) return

	const u: { identifier: string; code: string }[][] = []

	for (let ui = 0; ui < truthUnions.length; ui++) {
		if (
			!branchSchemas[ui] ||
			branchSchemas[ui]!.length !== truthUnions[ui]!.length
		)
			return

		const branch: { identifier: string; code: string }[] = []

		for (let i = 0; i < truthUnions[ui]!.length; i++) {
			const build = truthUnions[ui]![i]?.buildResult as
				| CheckBuildResult
				| undefined

			if (!build?.functions?.length || !build.entry) return

			// the live branch schema must reproduce this branch's externals
			if (
				!externalsMatch(
					collectExternals(branchSchemas[ui]![i]),
					build.external.variables
				)
			)
				return

			branch.push({
				identifier: build.external.identifier,
				code: reconstructCheckCode(build)
			})
		}

		u.push(branch)
	}
	return u
}

function captureMirrorCodecs(
	schema: unknown,
	truthCodecs: Function[],
	dir: 'decode' | 'encode' = 'decode'
) {
	const codecs = collectMirrorCodecs(schema, [], dir)
	if (codecs.length !== truthCodecs.length) return false

	for (let i = 0; i < codecs.length; i++)
		if (codecs[i] !== truthCodecs[i]) return false

	return true
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
	precomputedObjectDefault?: Record<string, unknown>
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
}

let capture: Map<string, CapturedValidator> | undefined

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

	capture ??= new Map()
	const k = `${method}_${path}_${slot}`

	let e = capture.get(k)
	if (!e) capture.set(k, (e = { method, path, slot }))

	return e
}

// @internal test isolation
export function beginValidatorCapture() {
	capture = new Map()
	coverageNeeds = []
	coverageUnfreezable = []
}

// @internal test isolation
export function endValidatorCapture() {
	const captured = capture ? [...capture.values()] : []
	capture = undefined

	return captured
}

export interface CoverageNeed {
	method: string
	path: string
	slot: ValidatorSlot
	check: boolean
	mirror: boolean
	decode: boolean
	encode: boolean
	hasDefault: boolean
	innerCodecs?: number
}

interface UnfreezableLoc {
	method?: string
	path?: string
	slot?: string
}

let coverageNeeds: CoverageNeed[] | undefined
let coverageUnfreezable: ({ reason: string } & UnfreezableLoc)[] | undefined

function captureNeed(v: CoverageNeed) {
	if (!isValidatorCapturing()) return
	;(coverageNeeds ??= []).push(v)
}

function captureUnfreezable(reason: string, loc?: UnfreezableLoc) {
	if (!isValidatorCapturing()) return
	;(coverageUnfreezable ??= []).push({ reason, ...loc })
}

export interface SealCoverageGap {
	method?: string
	path?: string
	slot?: string
	channel:
		| 'check'
		| 'mirror'
		| 'decode'
		| 'encode'
		| 'default'
		| 'innerCodec'
		| 'unfreezable'
	reason?: string
}

const needKey = (v: { method: string; path: string; slot: string }) =>
	`${v.method}\0${v.path}\0${v.slot}`

export function assertSealCoverage(
	captured: CapturedValidator[]
): SealCoverageGap[] {
	const needs = coverageNeeds ?? []
	const byKey = new Map<string, CapturedValidator>()
	for (const c of captured) byKey.set(needKey(c), c)

	const gaps: SealCoverageGap[] = []

	for (const n of needs) {
		const c = byKey.get(needKey(n))
		const loc = { method: n.method, path: n.path, slot: n.slot }

		if (n.check && !c?.checkValue) gaps.push({ ...loc, channel: 'check' })
		if (n.mirror && !c?.mirror) gaps.push({ ...loc, channel: 'mirror' })
		if (n.decode && !c?.decodeMirror)
			gaps.push({ ...loc, channel: 'decode' })
		if (n.encode && !c?.encodeMirror)
			gaps.push({ ...loc, channel: 'encode' })
		if (n.hasDefault && !c?.precomputeSafe)
			gaps.push({ ...loc, channel: 'default' })
		if (n.innerCodecs && (c?.innerCodecs?.length ?? 0) < n.innerCodecs)
			gaps.push({ ...loc, channel: 'innerCodec' })
	}

	for (const u of coverageUnfreezable ?? [])
		gaps.push({
			channel: 'unfreezable',
			reason: u.reason,
			method: u.method,
			path: u.path,
			slot: u.slot
		})

	return gaps
}

export interface CapturedHandler {
	method: string
	path: string
	alias: string
	code: string
}

let handlerCapture: Map<string, CapturedHandler> | undefined

function captureHandler(v: CapturedHandler) {
	if (!isValidatorCapturing()) return

	handlerCapture ??= new Map()
	handlerCapture.set(`${v.method}\0${v.path}`, v)
}

export function endHandlerCapture(): CapturedHandler[] {
	const captured = handlerCapture ? [...handlerCapture.values()] : []
	handlerCapture = undefined

	return captured
}

// Set capture fields on the (method,path,slot) entry. Replaces the per-channel
// setters — call sites pass the CapturedValidator field name(s) directly.
function captureSet(
	loc: { method: string; path: string; slot: ValidatorSlot },
	partial: Partial<CapturedValidator>
) {
	const e = captureEntry(loc)
	if (e) Object.assign(e, partial)
}

const isValidatorCapturing = () =>
	capture !== undefined || env.ELYSIA_AOT_BUILD === '1'

export const Capture = {
	set: captureSet,
	handler: captureHandler,
	mirrorUnions: captureMirrorUnions,
	mirrorCodecs: captureMirrorCodecs,
	need: captureNeed,
	unfreezable: captureUnfreezable,
	isCapturing: isValidatorCapturing
} as const
