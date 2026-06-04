import { CheckContext, Guard, Format, Hashing } from '../type/bridge'
import { env } from '../universal'

export type ValidatorSlot =
	| 'body'
	| 'query'
	| 'params'
	| 'headers'
	| 'cookie'
	| `response:${number}`

// exact mirror
export type FrozenCheckFactory = (
	CheckContext: unknown,
	Guard: unknown,
	Format: unknown,
	Hashing: unknown,
	External: unknown
) => (value: unknown) => boolean

export type FrozenMirrorFactory = (
	deps?: unknown
) => (value: unknown) => unknown

export interface FrozenMirror {
	// source code
	s: FrozenMirrorFactory
	// unions (`u[ui][i]`)
	u?: FrozenCheckFactory[][]
}

// TypeBox Validator
//
// @see `src/type/validator.ts`
export interface FrozenValidator {
	/** The check factory. Absent → the check JITs (only the mirror was frozen). */
	c?: FrozenCheckFactory
	// exact-mirror clean
	m?: FrozenMirror
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
	// alias parameter eg. 'pf,pj'
	a: string
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

	/** @internal test isolation */
	static clear() {
		validators = undefined
		handlers = undefined
	}
}

// mirrors TypeBox's internal CreateCode
export interface CheckBuildResult {
	functions: string[]
	entry: string
	useUnevaluated: boolean
	external: { identifier: string; variables: unknown[] }
}

export function reconstructCheckCode(build: CheckBuildResult) {
	const statements =
		(build.useUnevaluated
			? 'const context = new CheckContext({}, {});\n'
			: '') + `return ${build.entry}`

	return `${build.functions.join(';\n')}; return (value) => { ${statements} }`
}

// emit into bundle for frozen check
export const checkFactorySource = (identifier: string, code: string) =>
	`function(CheckContext,Guard,Format,Hashing,${identifier}){${code}}`

export const handlerFactorySource = (alias: string, code: string) =>
	`function(h${alias ? ',' + alias : ''}){return ${code}}`

export function instantiateFrozenCheck(
	frozen: FrozenValidator,
	externals: unknown[]
): (value: unknown) => boolean {
	return frozen.c!(CheckContext, Guard, Format, Hashing, externals)
}

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
			if (ok) continue // all elements matched → this external is fine
		}

		return false
	}

	return true
}

export const mirrorFactorySource = (source: string, hasExternals: boolean) =>
	hasExternals
		? `function(d){${source}}`
		: `function(d){return function(v){${source}}}`

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

		for (const b of schema.anyOf) collectMirrorUnions(b, out)
	}

	return out
}

export function instantiateFrozenMirror(
	frozen: FrozenMirror,
	schema: unknown
): (value: unknown) => unknown {
	if (!frozen.u) return frozen.s()

	const branchSchemas = collectMirrorUnions(schema)

	const unions = frozen.u.map((branches, ui) =>
		branches.map((factory, i) => ({
			Check: factory(
				CheckContext,
				Guard,
				Format,
				Hashing,
				collectExternals(branchSchemas[ui]![i])
			)
		}))
	)

	return frozen.s({ unions })
}

/**
 * verify that mirror unions can be reconstructed in build time
 *
 * return undefined if not reconstructable
 * `truthUnions` is `mir.externals.unions` (compiled branches).
 */
export function captureMirrorUnions(schema: unknown, truthUnions: any[][]) {
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
	// Check: `External` identifier, `reconstructCheckCode(buildResult)`
	identifier?: string
	code?: string
	// from `collectExternals`
	external?: boolean
	async?: boolean
	hasDefault?: boolean
	hasCodec?: boolean
	hasRef?: boolean
	mirror?: CapturedMirror
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
}

// @internal test isolation
export function endValidatorCapture() {
	const captured = capture ? [...capture.values()] : []
	capture = undefined

	return captured
}

export interface CapturedHandler {
	method: string
	path: string
	alias: string
	code: string
}

let handlerCapture: Map<string, CapturedHandler> | undefined

export function captureHandler(v: CapturedHandler) {
	if (!isValidatorCapturing()) return

	handlerCapture ??= new Map()
	handlerCapture.set(`${v.method}\0${v.path}`, v)
}

export function endHandlerCapture(): CapturedHandler[] {
	const captured = handlerCapture ? [...handlerCapture.values()] : []
	handlerCapture = undefined

	return captured
}

export function captureValidator(v: {
	method: string
	path: string
	slot: ValidatorSlot
	identifier: string
	code: string
	external: boolean
	async: boolean
	hasDefault: boolean
	hasCodec: boolean
	hasRef: boolean
}) {
	const e = captureEntry(v)

	if (e) {
		e.identifier = v.identifier
		e.code = v.code
		e.external = v.external
		e.async = v.async
		e.hasDefault = v.hasDefault
		e.hasCodec = v.hasCodec
		e.hasRef = v.hasRef
	}
}

export function captureMirror(v: {
	method: string
	path: string
	slot: ValidatorSlot
	mirror: CapturedMirror
}) {
	const e = captureEntry(v)
	if (e) e.mirror = v.mirror
}

export const isValidatorCapturing = () =>
	capture !== undefined || env.ELYSIA_AOT_BUILD === '1'
