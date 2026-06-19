import { Evaluate, Intersect, Module } from 'typebox/type'
import {
	Compile,
	Build,
	type Validator as BaseTypeBoxValidator
} from 'typebox/schema'
import type {
	Static,
	StaticDecode,
	StaticEncode,
	TAny,
	TSchema
} from 'typebox/type'
import {
	Clean,
	Decode,
	DecodeUnsafe,
	Default,
	Encode,
	EncodeUnsafe,
	Errors,
	HasCodec
} from 'typebox/value'
import type { TLocalizedValidationError } from 'typebox/error'

import createMirror from 'exact-mirror'

import {
	applyCoercions,
	CoerceOption,
	deferCoercions,
	nonAdditionalProperties
} from './coerce'

import { ELYSIA_TYPES } from './constants'
import { Validator, type ValidatorOptions } from '../validator'
import { isAsyncFunction } from '../compile/utils'

import {
	Compiled,
	instantiateFrozenMirror,
	instantiateFrozenDecodeMirror,
	instantiateFrozenEncodeMirror,
	instantiateFrozenBoth,
	collectExternals,
	externalsMatch,
	reconstructCheck,
	Capture,
	type CheckBuildResult,
	type CapturedMirror,
	type CapturedValidator,
	type FrozenValidator
} from '../compile/aot'

import { hasProperty } from './utils'
import {
	ASYNC_REFINE,
	collectFileTypeChecks,
	takeFileTypeChecks,
	type PendingFileTypeCheck
} from './elysia/file'
import { nullObject } from '../utils'
import { isCloudflareWorker } from '../universal/constants'
import { ValidationError } from '../error'

import type { MaybePromise } from '../types'

const moduleCache = new WeakMap<
	Record<string, TSchema>,
	Record<string, TSchema>
>()

function schemaContainsRef(node: any, seen = new WeakSet()): boolean {
	if (!node || typeof node !== 'object' || seen.has(node)) return false
	seen.add(node)

	if (node.$ref) return true

	const props = node.properties
	if (props) for (const k in props) if (schemaContainsRef(props[k], seen)) return true

	const items = node.items
	if (Array.isArray(items)) {
		for (const it of items) if (schemaContainsRef(it, seen)) return true
	} else if (items && schemaContainsRef(items, seen)) return true

	for (const key of ['anyOf', 'allOf', 'oneOf'] as const) {
		const arr = node[key]
		if (Array.isArray(arr))
			for (const x of arr) if (schemaContainsRef(x, seen)) return true
	}

	if (
		node.additionalProperties &&
		typeof node.additionalProperties === 'object' &&
		schemaContainsRef(node.additionalProperties, seen)
	)
		return true

	if (node.not && schemaContainsRef(node.not, seen)) return true

	const pp = node.patternProperties
	if (pp) for (const k in pp) if (schemaContainsRef(pp[k], seen)) return true

	return false
}

let inlineRefId = 0

// Shared empty externals for frozen checks
const EMPTY_EXTERNALS = Object.freeze([]) as unknown as unknown[]

const isAsyncPredicate = (v: unknown) =>
	Array.isArray(v)
		? v.some((x) =>
				typeof x.check === 'function'
					? isAsyncFunction(x.check) || x.check[ASYNC_REFINE] === true
					: false
			)
		: false

async function enforceFileTypeChecks(
	pending: PendingFileTypeCheck[],
	type: string | undefined,
	value: unknown,
	schema: unknown
): Promise<void> {
	const results = await Promise.all(pending.map((x) => x.check))

	for (let i = 0; i < results.length; i++)
		if (results[i] !== true)
			throw new ValidationError(
				type,
				value,
				[
					{
						instancePath:
							findInstancePath(value, pending[i].file) ?? '',
						message: results[i]
					}
				],
				schema
			)
}

function findInstancePath(
	value: unknown,
	target: unknown,
	path = ''
): string | undefined {
	if (value === target) return path
	if (!value || typeof value !== 'object') return undefined

	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			const found = findInstancePath(value[i], target, `${path}/${i}`)
			if (found !== undefined) return found
		}

		return undefined
	}

	for (const key in value) {
		const found = findInstancePath(
			(value as Record<string, unknown>)[key],
			target,
			`${path}/${key}`
		)
		if (found !== undefined) return found
	}

	return undefined
}

function isPrecomputeSafe(schema: any, depth = 0): boolean {
	if (!schema || typeof schema !== 'object') return true

	const kind = schema['~kind']
	if (
		kind === 'Union' ||
		kind === 'Intersect' ||
		kind === 'Ref' ||
		kind === 'This' ||
		kind === 'Cyclic'
	)
		return false

	// Codec and Refine wrappers attach as `~codec` / `~refine` markers on the
	// underlying schema; `~kind` shows the wrapped type, not the wrapper.
	if (schema['~codec'] || schema['~refine']) return false

	// Nested Object without its own default - not preallocatable.
	if (
		depth > 0 &&
		(kind === 'Object' || schema.type === 'object') &&
		schema.default === undefined
	)
		return false

	if (schema.properties)
		for (const v of Object.values(schema.properties))
			if (!isPrecomputeSafe(v, depth + 1)) return false

	if (schema.items) {
		if (Array.isArray(schema.items)) {
			for (const v of schema.items)
				if (!isPrecomputeSafe(v, depth + 1)) return false
		} else if (!isPrecomputeSafe(schema.items, depth + 1)) return false
	}

	if (
		typeof schema.additionalProperties === 'object' &&
		!isPrecomputeSafe(schema.additionalProperties, depth + 1)
	)
		return false

	if (schema.patternProperties)
		for (const v of Object.values(schema.patternProperties))
			if (!isPrecomputeSafe(v, depth + 1)) return false

	return true
}

// recursive merge precompute default
function applyPrecomputed(
	defaults: Record<string, unknown>,
	value: Record<string, unknown>
): Record<string, unknown> {
	const out: Record<string, unknown> = nullObject()

	// clone in case of a shared reference default value
	for (const k in defaults) {
		const d = defaults[k]
		out[k] =
			value[k] === undefined && d !== null && typeof d === 'object'
				? structuredClone(d)
				: d
	}

	for (const k in value) {
		const v = value[k]
		if (v === undefined) continue
		const d = out[k]
		if (
			v &&
			typeof v === 'object' &&
			!Array.isArray(v) &&
			d &&
			typeof d === 'object' &&
			!Array.isArray(d)
		)
			out[k] = applyPrecomputed(
				d as Record<string, unknown>,
				v as Record<string, unknown>
			)
		else out[k] = v
	}

	return out
}

const subtreeHasDefault = (n: any): boolean =>
	!!n &&
	typeof n === 'object' &&
	('default' in n || childSchemaSome(n, subtreeHasDefault))

function childSchemaSome(n: any, f: (x: any) => boolean): boolean {
	if (!n || typeof n !== 'object') return false

	if (n.properties)
		for (const k in n.properties) if (f(n.properties[k])) return true

	const items = n.items
	if (Array.isArray(items)) {
		for (const it of items) if (f(it)) return true
	} else if (items && f(items)) return true

	for (const key of ['anyOf', 'allOf', 'oneOf'] as const) {
		const arr = n[key]
		if (Array.isArray(arr)) for (const s of arr) if (f(s)) return true
	}

	if (typeof n.additionalProperties === 'object' && f(n.additionalProperties))
		return true

	if (n.patternProperties)
		for (const k in n.patternProperties) if (f(n.patternProperties[k]))
			return true

	for (const key of ['not', 'if', 'then', 'else'] as const)
		if (n[key] && f(n[key])) return true

	return false
}

const hasDefaultBelow = (node: any) => childSchemaSome(node, subtreeHasDefault)

function hasDivergentDefaultBelow(node: any): boolean {
	const ownKey = 'default' in node ? canonical(node.default) : undefined
	let bad = false
	const visit = (n: any): boolean => {
		if (!n || typeof n !== 'object') return false
		if (
			'default' in n &&
			(ownKey === undefined || canonical(n.default) !== ownKey)
		) {
			bad = true
			return true
		}
		return childSchemaSome(n, visit)
	}
	childSchemaSome(node, visit)
	return bad
}

function structuralPreallocatable(schema: any, depth = 0): boolean {
	if (!schema || typeof schema !== 'object') return true

	if (
		!(
			(schema['~kind'] === 'Object' || schema.type === 'object') &&
			!schema['~codec'] &&
			!schema['~refine'] &&
			!Array.isArray(schema.anyOf) &&
			!Array.isArray(schema.allOf) &&
			!Array.isArray(schema.oneOf) &&
			schema.$ref === undefined &&
			schema.if === undefined &&
			schema.not === undefined
		)
	)
		return !hasDivergentDefaultBelow(schema)

	if (depth > 0 && schema.default === undefined && hasDefaultBelow(schema))
		return false

	if (
		typeof schema.additionalProperties === 'object' &&
		subtreeHasDefault(schema.additionalProperties)
	)
		return false

	if (schema.patternProperties)
		for (const k in schema.patternProperties)
			if (subtreeHasDefault(schema.patternProperties[k])) return false

	if (schema.properties)
		for (const k in schema.properties)
			if (!structuralPreallocatable(schema.properties[k], depth + 1))
				return false

	return true
}

function isEmittable(v: unknown, seen: Set<unknown>, top = false): boolean {
	if (v === undefined) return top
	if (v === null) return true
	const t = typeof v
	if (t === 'number') return Number.isFinite(v as number) && !Object.is(v, -0)
	if (t === 'string' || t === 'boolean') return true
	if (t !== 'object') return false
	if (seen.has(v)) return false
	seen.add(v)

	let ok = true
	if (Array.isArray(v)) {
		for (const x of v)
			if (!isEmittable(x, seen)) {
				ok = false
				break
			}
	} else {
		const proto = Object.getPrototypeOf(v)
		if (proto !== Object.prototype && proto !== null) ok = false
		else
			for (const k in v) {
				if (k === '__proto__') {
					ok = false
					break
				}
				if (!Object.prototype.hasOwnProperty.call(v, k)) continue
				if (!isEmittable((v as Record<string, unknown>)[k], seen)) {
					ok = false
					break
				}
			}
	}

	seen.delete(v)
	return ok
}

const PROBE_SENTINEL = '__elysia_default_probe__'

function* defaultProbes(
	pod: Record<string, unknown> | undefined
): Generator<Record<string, unknown>> {
	if (!pod) return
	yield {}
	for (const k in pod) {
		yield { [k]: PROBE_SENTINEL }
		const d = pod[k]
		if (d && typeof d === 'object' && !Array.isArray(d)) {
			yield { [k]: {} }
			for (const k2 in d as Record<string, unknown>) {
				yield { [k]: { [k2]: PROBE_SENTINEL } }
				break
			}
		}
	}
}

function canonical(v: unknown): string {
	if (v === undefined) return '\0u'
	if (Object.is(v, -0)) return '-0'
	if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? '\0u'
	if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
	return (
		'{' +
		Object.keys(v)
			.sort()
			.map(
				(k) =>
					JSON.stringify(k) +
					':' +
					canonical((v as Record<string, unknown>)[k])
			)
			.join(',') +
		'}'
	)
}

// ----------------------------------------------------------------------------
// Build-time default preallocation (capture only): `Default(schema, value)` is a
// pure function of the build-time-known schema, so the frozen runtime reads the
// baked `pd`/`pod` instead of running TypeBox `Default()` at construction. The
// decision is sound by two layers: a structural gate + a differential guard that
// replays `Default(schema, probe)` against `applyPrecomputed(pod, probe)`.
// ----------------------------------------------------------------------------
function verifyPreallocatableDefault(
	schema: TSchema
): { pd: unknown; pod: Record<string, unknown> | undefined } | undefined {
	let pd: unknown
	let podRaw: unknown
	try {
		pd = Default(schema, undefined)
		podRaw = Default(schema, nullObject())
	} catch {
		return undefined
	}

	const pod =
		podRaw && typeof podRaw === 'object' && !Array.isArray(podRaw)
			? (podRaw as Record<string, unknown>)
			: undefined

	if (
		!isEmittable(pd, new Set(), true) ||
		(pod !== undefined && !isEmittable(pod, new Set(), true))
	)
		return undefined

	if (!isPrecomputeSafe(schema as any)) {
		const s = schema as any
		if (s.type !== 'object' && s['~kind'] !== 'Object') return undefined
		if (!structuralPreallocatable(schema as any)) return undefined

		for (const probe of defaultProbes(pod)) {
			let expected: unknown
			try {
				expected = Default(schema, structuredClone(probe))
			} catch {
				return undefined
			}
			const actual = applyPrecomputed(pod!, structuredClone(probe))
			if (canonical(expected) !== canonical(actual)) return undefined
		}
	}

	return { pd, pod }
}

function collectCustomErrorNodes(
	schema: any,
	path: string,
	out: { path: string; node: any }[]
): { path: string; node: any }[] {
	if (!schema || typeof schema !== 'object') return out
	if (schema.error !== undefined) out.push({ path, node: schema })
	if (schema.properties)
		for (const k in schema.properties)
			collectCustomErrorNodes(schema.properties[k], path + '/' + k, out)
	return out
}

function subValueAt(value: any, path: string): unknown {
	if (!path) return value
	let cur = value
	for (const part of path.split('/')) {
		if (!part) continue
		if (cur === null || typeof cur !== 'object') return undefined
		cur = cur[part]
	}
	return cur
}

// Walk for ely-ObjectString / ArrayString union nodes in deterministic PRE-ORDER
// (parent before nested). Both capture and reconstruction use this single walker
// so the `ic[]` array aligns 1:1 with the nodes; reconstruction iterates it in
// REVERSE for bottom-up overwrite. For each: inner = `anyOf[0]`, codec =
// `anyOf[1]`, open = `{` (123) / `[` (91), and the value-`path`/`inArray` used to
// apply the inner default on the OBJECT branch.
interface StringCodecNode {
	inner: any
	codec: any
	open: number
	path: string[]
	inArray: boolean
}
function collectStringCodecNodes(
	schema: any,
	out: StringCodecNode[] = [],
	path: string[] = [],
	inArray = false
): StringCodecNode[] {
	if (!schema || typeof schema !== 'object') return out

	const ely = schema['~elyTyp']
	if (ely === ELYSIA_TYPES.ObjectString || ely === ELYSIA_TYPES.ArrayString) {
		const inner = schema.anyOf?.[0]
		const codec = schema.anyOf?.[1]
		if (inner && codec?.['~codec'] && codec['~refine'])
			out.push({
				inner,
				codec,
				open: ely === ELYSIA_TYPES.ObjectString ? 123 : 91,
				path,
				inArray
			})
	}

	if (schema.properties)
		for (const k in schema.properties)
			collectStringCodecNodes(
				schema.properties[k],
				out,
				[...path, k],
				inArray
			)

	const items = schema.items
	if (Array.isArray(items)) {
		for (const it of items) collectStringCodecNodes(it, out, path, true)
	} else if (items) collectStringCodecNodes(items, out, path, true)

	// union branches sit at the SAME value position → same path
	if (Array.isArray(schema.anyOf))
		for (const b of schema.anyOf)
			collectStringCodecNodes(b, out, path, inArray)

	return out
}

// A default INSIDE an ObjectString/ArrayString inner is baked into that codec's
// `ic.pod` (not the parent's `ps`/`pod`), so it must NOT count toward the parent's
// default coverage need — otherwise a `{ filter: { role: t.String({default}) } }`
// query is wrongly refused for "default not frozen".
function hasDefaultOutsideStringCodec(schema: any): boolean {
	if (!schema || typeof schema !== 'object') return false

	const ely = schema['~elyTyp']
	if (ely === ELYSIA_TYPES.ObjectString || ely === ELYSIA_TYPES.ArrayString)
		return false

	if ('default' in schema) return true

	if (schema.properties)
		for (const k in schema.properties)
			if (hasDefaultOutsideStringCodec(schema.properties[k])) return true

	const items = schema.items
	if (Array.isArray(items)) {
		for (const it of items)
			if (hasDefaultOutsideStringCodec(it)) return true
	} else if (items && hasDefaultOutsideStringCodec(items)) return true

	for (const key of ['anyOf', 'allOf', 'oneOf'] as const)
		if (Array.isArray(schema[key]))
			for (const b of schema[key])
				if (hasDefaultOutsideStringCodec(b)) return true

	return false
}

// Sealed-runtime reconstruction (typebox-free): overwrite each ObjectString /
// ArrayString codec's `~codec.decode` + `~refine[0].check` with closures backed
// by the frozen inner check + decode mirror, so the codec stops delegating to
// typebox/value. Bottom-up (reverse of the pre-order `ic`) so nested codecs are
// rebuilt typebox-free before a containing inner mirror/check reads them. Runs
// BEFORE the parent check / decode mirror are instantiated. Returns the per-path
// inner-default templates for the From default step (object branch).
function reconstructInnerCodecs(
	ic: NonNullable<FrozenValidator['ic']>,
	schema: any
): Array<{ path: string[]; pod: Record<string, unknown> }> {
	const nodes = collectStringCodecNodes(schema)
	const innerDefaults: Array<{
		path: string[]
		pod: Record<string, unknown>
	}> = []

	for (let i = nodes.length - 1; i >= 0; i--) {
		const entry = ic[i]
		const node = nodes[i]
		if (!entry || !node) continue

		const innerSchema = node.inner
		const innerCheck = entry.c(entry.e ? collectExternals(innerSchema) : [])
		// `x:1` → factory form (codecs/unions rebuilt from the live schema);
		// otherwise `s` is the plain (v)=>cleaned cleaner
		const innerMirror = entry.d.x
			? instantiateFrozenDecodeMirror(entry.d, innerSchema)
			: (entry.d.s as (value: unknown) => unknown)
		const pod = entry.pod

		const fill = pod
			? (parsed: unknown) =>
					applyPrecomputed(pod, parsed as Record<string, unknown>)
			: (parsed: unknown) => parsed

		const open = entry.o
		// The live string-branch refine is a BARE `Check(inner, JSON.parse(v))`
		// (object-string.ts) that applies NO defaults — a missing defaulted key is
		// rejected, the default is materialised only by the decode transform (which
		// runs after a passing check). So the reconstructed refine must NOT fill
		// defaults (else the sealed app would accept input the plain app rejects).
		// Object-branch defaults are handled by `#applyInnerDefaults`.
		node.codec['~refine'][0].check = (v: string) => {
			if (v.charCodeAt(0) !== open) return false
			try {
				return innerCheck(JSON.parse(v))
			} catch {
				return false
			}
		}
		// decode is reached only after a passing check (all required keys present),
		// so `fill` here is a no-op clone — kept for symmetry/robustness
		node.codec['~codec'].decode = (v: string) =>
			innerMirror(fill(JSON.parse(v)))

		// OBJECT-branch default: a JSON query value is pre-parsed to an object, so
		// it never hits the string codec above — record (path, pod) so the From
		// default step fills it (capture refuses array-nested inner defaults, so
		// `path` here is object-property-only).
		if (pod) innerDefaults.push({ path: node.path, pod })
	}

	return innerDefaults
}

// Build-time: freeze one ObjectString/ArrayString inner schema into a check
// (reconstructCheck source) + decode mirror (exact-mirror) + optional baked
// default template. Returns undefined when the inner can't be frozen (hof
// sanitize, non-reproducible externals/unions, non-preallocatable / array-nested
// default) → the seal coverage gate then refuses the build.
function captureInnerCodec(
	inner: any,
	open: number,
	inArray: boolean,
	sanitize: ValidatorOptions['sanitize']
): NonNullable<CapturedValidator['innerCodecs']>[number] | undefined {
	let identifier: string
	let checkDefs: string
	let checkValue: string
	let external: boolean
	try {
		const b = Build(inner) as unknown as CheckBuildResult
		if (!b?.functions?.length || !b.entry) return undefined
		const vars = b.external.variables
		if (!externalsMatch(collectExternals(inner), vars)) return undefined
		const cr = reconstructCheck(b)
		identifier = b.external.identifier
		checkDefs = cr.defs
		checkValue = cr.value
		external = vars.length > 0
	} catch {
		return undefined
	}

	let decode: CapturedMirror
	try {
		const emitted = createMirror(inner, {
			Compile,
			sanitize,
			decode: true,
			emit: true
		}) as { source?: string; externals?: any }
		if (typeof emitted?.source !== 'string') return undefined
		const ext = emitted.externals
		if (ext?.hof) return undefined
		if (ext?.codecs && !Capture.mirrorCodecs(inner, ext.codecs))
			return undefined
		let u: { identifier: string; code: string }[][] | undefined
		if (ext?.unions && ext.unions.length) {
			u = Capture.mirrorUnions(inner, ext.unions)
			if (!u) return undefined
		}
		// exact-mirror emits a (d)=>(v)=> FACTORY when it has codecs/unions, else
		// a plain (v)=> cleaner — track which so reconstruction calls it correctly
		const hasExternals = !!(ext?.codecs || u)
		decode = { source: emitted.source, hasExternals, u }
	} catch {
		return undefined
	}

	let pod: Record<string, unknown> | undefined
	if (hasProperty('default', inner)) {
		// exact-mirror drops inner defaults — bake an object-default template. A
		// non-object-shaped / non-preallocatable / array-nested inner default → refuse.
		if (inArray) return undefined
		const pre = verifyPreallocatableDefault(inner)
		if (!pre || pre.pod === undefined) return undefined
		pod = pre.pod
	}

	return { open, identifier, checkDefs, checkValue, external, decode, pod }
}

function sourceOnlyValidator(schema: TSchema): BaseTypeBoxValidator {
	const buildResult = Build(schema)
	let full: BaseTypeBoxValidator | undefined

	return new Proxy({} as unknown as BaseTypeBoxValidator, {
		get(_, prop) {
			if (prop === 'buildResult') return buildResult

			const f = (full ??= Compile(schema))
			const value = (f as any)[prop]

			return typeof value === 'function' ? value.bind(f) : value
		}
	})
}

export class TypeBoxValidator<
	const in out T extends TSchema = TAny
> extends Validator {
	// undefined is reconstruct via aot
	tb?: BaseTypeBoxValidator

	// build time check, bound eagerly from the frozen manifest at construction
	reconstructedCheck?: (value: unknown) => boolean

	schema!: T

	hasCodec!: boolean
	isAsync!: boolean
	hasDefault!: boolean

	#decodeMirror?: (value: unknown) => unknown
	#encodeMirror?: (value: unknown) => unknown
	#findCustomError?: (
		value: unknown
	) => { instancePath: string; error: unknown } | undefined

	// default value
	precomputeSafe = false
	#precomputedDefault: unknown
	#precomputedObjectDefault: Record<string, unknown> | undefined
	// sealed-only: ObjectString/ArrayString inner defaults, applied at their
	// value-path in the From default step (the OBJECT branch)
	#innerDefaults:
		| Array<{ path: string[]; pod: Record<string, unknown> }>
		| undefined

	#noValidate!: boolean
	#isForm = false
	#hasOptional = false

	constructor(
		schema: T,
		options?: ValidatorOptions,
		name?: string,
		isIntersectable?: boolean
	) {
		super()

		if (isIntersectable)
			schema = Evaluate(
				Intersect([schema, ...options!.schemas!] as any)
			) as unknown as T

		const originalElyTyp = (schema as any)?.['~elyTyp']

		const frozen =
			options?.aot && options.slot
				? Compiled.getValidator(
						options.aot.method,
						options.aot.path,
						options.slot
					)
				: undefined

		let schemaHasRef = false
		if (name && options?.models)
			schema = (
				moduleCache.getOrInsertComputed(options.models, () =>
					Module(options.models as Record<string, TSchema>)
				) as any
			)[name]
		else if (options?.models && typeof name !== 'string') {
			schemaHasRef = frozen
				? frozen.r === 1
				: schemaContainsRef(schema)
			if (schemaHasRef) {
				const id = `inline@${++inlineRefId}`
				schema = (
					Module({
						...options.models,
						[id]: schema
					} as Record<string, TSchema>) as any
				)[id]
			}
		}

		const isFrozen = this.#reconstruct(options, frozen)

		this.schema = (
			isFrozen && !this.hasCodec
				? schema
				: applyCoercions(schema as any, options?.coerces)
		) as T

		if (
			options?.normalize === false &&
			options.slot !== 'headers' &&
			options.slot !== 'cookie'
		)
			this.schema = nonAdditionalProperties(this.schema as any) as T

		// On a sealed build every validator is frozen (the coverage assertion
		// guarantees it), so this whole JIT/capture block — Compile, HasCodec,
		// sourceOnlyValidator and #maybeCapture — DCEs out, dropping typebox/compile
		// + the capture-only refs.
		if (!isFrozen && !globalThis.__ELYSIA_SEALED__) {
			const capturing = Capture.isCapturing()
			this.tb = capturing
				? sourceOnlyValidator(this.schema as TSchema)
				: Compile(this.schema as TSchema)
			this.hasCodec = HasCodec(this.schema)
			this.isAsync =
				// @ts-expect-error private property
				this.tb.buildResult.external.variables.some(isAsyncPredicate) ??
				false

			this.hasDefault = hasProperty('default', this.schema as any)

			if (capturing) this.#maybeCapture(options, schemaHasRef)
			else this.#dropCompiledSource()
		}

		if (frozen?.ps === 1) {
			this.precomputeSafe = true
			this.#precomputedDefault = frozen.pd
			this.#precomputedObjectDefault =
				frozen.pod !== undefined
					? (Object.freeze(frozen.pod) as Record<string, unknown>)
					: undefined
		} else if (!globalThis.__ELYSIA_SEALED__) {
			this.precomputeSafe =
				this.hasDefault && isPrecomputeSafe(this.schema as any)

			if (this.precomputeSafe) {
				this.#precomputedDefault = Default(this.schema, undefined)
				const obj = Default(this.schema, nullObject()) as unknown
				this.#precomputedObjectDefault =
					obj && typeof obj === 'object' && !Array.isArray(obj)
						? (Object.freeze(obj) as Record<string, unknown>)
						: undefined
			} else {
				this.#precomputedDefault = undefined
				this.#precomputedObjectDefault = undefined
			}
		}

		this.#noValidate = originalElyTyp === ELYSIA_TYPES.NoValidate
		this.#isForm = originalElyTyp === ELYSIA_TYPES.Form
		this.#hasOptional = !!(this.schema as any)?.['~optional']

		// Tier 2: rewrite ObjectString/ArrayString codec closures to be
		// typebox-free, BEFORE the parent check / decode mirror are instantiated
		// below (they re-read these live nodes). Only present on a sealed frozen build.
		if (frozen?.ic) {
			const innerDefaults = reconstructInnerCodecs(frozen.ic, this.schema)
			if (innerDefaults.length) this.#innerDefaults = innerDefaults
		}

		if (isFrozen && frozen!.cm) {
			const both = instantiateFrozenBoth(frozen!, this.schema, schema)
			this.reconstructedCheck = both.check
			this.Clean =
				options?.normalize === false ? undefined : both.clean
		} else {
			if (isFrozen)
				this.reconstructedCheck = frozen!.c!(
					frozen!.e ? collectExternals(this.schema) : EMPTY_EXTERNALS
				)

			try {
				this.Clean =
					options?.normalize === false
						? undefined
						: // `normalize:'typebox'` is refused on a sealed build (it
							// uses TypeBox `Clean`), so this arm DCEs out when sealed
							options?.normalize === 'typebox'
							? globalThis.__ELYSIA_SEALED__
								? undefined
								: (value) => Clean(this.schema, value)
							: this.#setupMirror(schema, options, frozen)
			} catch (error) {
				console.warn(
					'Failed to create exactMirror. Please report the following code to https://github.com/elysiajs/elysia/issues'
				)
				console.warn(schema)
				console.warn(error)

				if (
					options?.normalize !== false &&
					!globalThis.__ELYSIA_SEALED__
				)
					this.Clean = (value) => Clean(this.schema, value)
			}
		}

		if (
			this.hasCodec &&
			!this.#isForm &&
			!this.#noValidate &&
			!options?.slot?.startsWith('r') &&
			options?.normalize !== false &&
			options?.normalize !== 'typebox'
		)
			this.#decodeMirror = this.#setupDecodeMirror(
				this.schema as TSchema,
				options,
				frozen
			)

		if (
			this.hasCodec &&
			!this.#isForm &&
			!this.#noValidate &&
			options?.slot?.startsWith('r') &&
			options?.normalize !== false &&
			options?.normalize !== 'typebox'
		)
			this.#encodeMirror = this.#setupEncodeMirror(
				this.schema as TSchema,
				options,
				frozen
			)

		if (!this.#noValidate) this.#findCustomError = this.#buildFindCustomError(frozen)

		// Record this validator's runtime need profile for the seal coverage
		// assertion (capture-only).
		if (Capture.isCapturing())
			if (options?.aot && options.slot)
				if (options.normalize === 'typebox')
					Capture.unfreezable(
						`${options.aot.method} ${options.aot.path} (${options.slot}): normalize:'typebox' uses TypeBox Clean`
					)
				else
					Capture.need({
						method: options.aot.method,
						path: options.aot.path,
						slot: options.slot,
						check: true,
						mirror: this.Clean !== undefined,
						decode: this.#decodeMirror !== undefined,
						encode: this.#encodeMirror !== undefined,
						// defaults inside ObjectString/ArrayString inners are baked
						// into `ic.pod`, not the parent's `ps` — exclude them
						hasDefault:
							this.hasDefault &&
							hasDefaultOutsideStringCodec(this.schema as any),
						// each ObjectString/ArrayString inner must freeze (Tier 2);
						// a short/absent `ic` → refuse (assertSealCoverage)
						innerCodecs: collectStringCodecNodes(this.schema as any)
							.length
					})
			else
				Capture.unfreezable(
					'a validator was built outside the AOT route path ' +
						'(WebSocket / dynamic / standalone-guard)'
				)
	}

	#buildFindCustomError(
		frozen?: FrozenValidator
	):
		| ((value: unknown) => { instancePath: string; error: unknown } | undefined)
		| undefined {
		const nodes = collectCustomErrorNodes(this.schema as any, '', [])
		if (!nodes.length) return undefined

		const frozenByPath = frozen?.ce
			? new Map(frozen.ce.map((e) => [e.p, e]))
			: undefined

		const checks: {
			path: string
			check: (v: unknown) => boolean
			error: unknown
		}[] = []

		for (const { path, node } of nodes) {
			let check: ((v: unknown) => boolean) | undefined

			const fe = frozenByPath?.get(path)
			if (fe)
				try {
					check = fe.c(fe.e ? collectExternals(node) : EMPTY_EXTERNALS)
				} catch {}
			// sealed: every custom-error node is frozen (`ce` channel), so this
			// TypeBox `Compile` fallback DCEs out
			else if (!globalThis.__ELYSIA_SEALED__)
				try {
					const c = Compile(node)
					check = (v) => c.Check(v)
				} catch {}

			if (check) checks.push({ path, check, error: node.error })
		}

		if (!checks.length) return undefined

		// deepest (most specific) field first; root ('') last
		checks.sort((a, b) => b.path.length - a.path.length)

		return (value) => {
			for (const c of checks)
				if (!c.check(subValueAt(value, c.path)))
					return { instancePath: c.path, error: c.error }
			return undefined
		}
	}

	#verr(value: unknown, type?: string): ValidationError {
		return new ValidationError(
			type,
			value,
			() => this.Errors(value),
			this.schema,
			this.#findCustomError
		)
	}

	#setupMirror(
		schema: TSchema,
		options?: ValidatorOptions,
		frozen?: FrozenValidator
	): ((value: unknown) => unknown) | undefined {
		const aot = options?.aot
		const slot = options?.slot

		if (aot && slot && frozen?.m) {
			const m = frozen.m
			let clean: ((value: unknown) => unknown) | undefined

			return (value: unknown) => {
				if (clean === undefined)
					try {
						clean = instantiateFrozenMirror(m, schema)
					} catch (error) {
						console.warn(
							'Failed to create exactMirror. Please report the following code to https://github.com/elysiajs/elysia/issues'
						)
						console.warn(schema)
						console.warn(error)
						clean = (v) => v
					}

				return clean(value)
			}
		}

		// On a sealed build every mirror is in the manifest, so the exact-mirror
		// JIT/capture fallback DCEs out.
		if (!globalThis.__ELYSIA_SEALED__ && aot && slot) {
			if (Capture.isCapturing())
				try {
					const emitted = createMirror(schema, {
						Compile,
						sanitize: options?.sanitize,
						emit: true
					}) as { source?: string; externals?: any }

					if (typeof emitted?.source === 'string') {
						const ext = emitted.externals

						if (!ext)
							Capture.mirror({
								method: aot.method,
								path: aot.path,
								slot,
								mirror: {
									source: emitted.source,
									hasExternals: false
								}
							})
						else if (ext.unions && !ext.hof) {
							const u = Capture.mirrorUnions(schema, ext.unions)

							if (u)
								Capture.mirror({
									method: aot.method,
									path: aot.path,
									slot,
									mirror: {
										source: emitted.source,
										hasExternals: true,
										u
									}
								})
						}
					}
				} catch {}
		}

		return globalThis.__ELYSIA_SEALED__
			? undefined
			: (createMirror(schema, {
					Compile,
					sanitize: options?.sanitize
				}) as (value: unknown) => unknown)
	}

	#setupDecodeMirror(
		schema: TSchema,
		options?: ValidatorOptions,
		frozen?: FrozenValidator
	): ((value: unknown) => unknown) | undefined {
		const aot = options?.aot
		const slot = options?.slot

		if (aot && slot && frozen?.dm) {
			const dm = frozen.dm
			let decode: ((value: unknown) => unknown) | undefined

			return (value: unknown) => {
				if (decode === undefined)
					try {
						decode = instantiateFrozenDecodeMirror(dm, schema)
					} catch (e) {
						// sealed: the frozen decode mirror is guaranteed (coverage).
						// Form B so the typebox/value DecodeUnsafe import tree-shakes.
						if (!globalThis.__ELYSIA_SEALED__)
							decode = (v) => {
								// @ts-ignore
								const decoded = DecodeUnsafe(
									nullObject(),
									schema,
									v
								)
								return this.Clean
									? this.Clean(decoded)
									: decoded
							}
						else throw e
					}

				return decode(value)
			}
		}

		// sealed: the decode JIT/capture fallback DCEs out (see #setupMirror).
		if (
			!globalThis.__ELYSIA_SEALED__ &&
			aot &&
			slot &&
			Capture.isCapturing() &&
			!slot.startsWith('response')
		)
			try {
				const emitted = createMirror(schema, {
					Compile,
					sanitize: options?.sanitize,
					decode: true,
					emit: true
				}) as { source?: string; externals?: any }

				if (typeof emitted?.source === 'string') {
					const ext = emitted.externals

					if (
						ext?.codecs &&
						!ext.hof &&
						Capture.mirrorCodecs(schema, ext.codecs)
					) {
						let u:
							| { identifier: string; code: string }[][]
							| undefined
						let freezable = true

						if (ext.unions && ext.unions.length) {
							u = Capture.mirrorUnions(schema, ext.unions)
							if (!u) freezable = false
						}

						if (freezable)
							Capture.mirrorDecode({
								method: aot.method,
								path: aot.path,
								slot,
								mirror: {
									source: emitted.source,
									hasExternals: true,
									u
								}
							})
					}
				}
			} catch {}

		if (!globalThis.__ELYSIA_SEALED__)
			try {
				return createMirror(schema, {
					Compile,
					sanitize: options?.sanitize,
					decode: true
				}) as (value: unknown) => unknown
			} catch {}

		return undefined
	}

	#setupEncodeMirror(
		schema: TSchema,
		options?: ValidatorOptions,
		frozen?: FrozenValidator
	): ((value: unknown) => unknown) | undefined {
		const aot = options?.aot
		const slot = options?.slot

		if (aot && slot && frozen?.em) {
			const em = frozen.em
			let encode: ((value: unknown) => unknown) | undefined

			return (value: unknown) => {
				if (encode === undefined)
					try {
						encode = instantiateFrozenEncodeMirror(em, schema)
					} catch (e) {
						// sealed: the frozen encode mirror is guaranteed (coverage).
						// Form B so the typebox/value `Encode` import tree-shakes.
						if (!globalThis.__ELYSIA_SEALED__)
							encode = (v) => {
								const out = Encode(schema, v as any)
								return this.Clean ? this.Clean(out) : out
							}
						else throw e
					}

				return encode(value)
			}
		}

		// sealed: the encode JIT/capture fallback DCEs out (see #setupMirror).
		if (
			!globalThis.__ELYSIA_SEALED__ &&
			aot &&
			slot &&
			Capture.isCapturing() &&
			slot.startsWith('r')
		)
			try {
				const emitted = createMirror(schema, {
					Compile,
					sanitize: options?.sanitize,
					encode: true,
					emit: true
				}) as { source?: string; externals?: any }

				if (typeof emitted?.source === 'string') {
					const ext = emitted.externals

					if (
						ext?.codecs &&
						!ext.hof &&
						Capture.mirrorCodecs(schema, ext.codecs, 'encode')
					) {
						let u:
							| { identifier: string; code: string }[][]
							| undefined
						let freezable = true

						if (ext.unions && ext.unions.length) {
							u = Capture.mirrorUnions(schema, ext.unions)
							if (!u) freezable = false
						}

						if (freezable)
							Capture.mirrorEncode({
								method: aot.method,
								path: aot.path,
								slot,
								mirror: {
									source: emitted.source,
									hasExternals: true,
									u
								}
							})
					}
				}
			} catch {}

		if (!globalThis.__ELYSIA_SEALED__)
			try {
				return createMirror(schema, {
					Compile,
					sanitize: options?.sanitize,
					encode: true
				}) as (value: unknown) => unknown
			} catch {}

		return undefined
	}

	Check(value: Static<T>): boolean {
		return this.reconstructedCheck
			? this.reconstructedCheck(value)
			: this.tb!.Check(value)
	}

	#reconstruct(
		options: ValidatorOptions | undefined,
		frozen: FrozenValidator | undefined
	): boolean {
		if (!options?.aot || !options.slot || options.normalize === 'typebox')
			return false
		if (!frozen?.c && !frozen?.cm) return false

		this.isAsync = frozen.a === 1
		this.hasDefault = frozen.d === 1
		this.hasCodec = frozen.k === 1

		return true
	}

	#maybeCapture(
		options: ValidatorOptions | undefined,
		hasRef: boolean
	): void {
		const aot = options?.aot
		const slot = options?.slot
		if (!aot || !slot || !Capture.isCapturing()) return

		// form-B gate: under seal the build-only default verifier (and its TypeBox
		// `Default` probes) tree-shakes out — capture never runs at sealed runtime.
		if (this.hasDefault && !globalThis.__ELYSIA_SEALED__) {
			const pre = verifyPreallocatableDefault(this.schema as TSchema)
			if (pre)
				Capture.precompute({
					method: aot.method,
					path: aot.path,
					slot,
					precomputedDefault: pre.pd,
					precomputedObjectDefault: pre.pod
				})
		}

		// Freeze a per-field check for each custom-error field.
		const ceNodes = collectCustomErrorNodes(this.schema as any, '', [])
		if (ceNodes.length) {
			const entries: NonNullable<
				Parameters<typeof Capture.customErrors>[0]['entries']
			> = []
			for (const { path, node } of ceNodes)
				try {
					const b = Build(node) as unknown as CheckBuildResult
					if (!b?.functions?.length || !b.entry) continue
					const vars = b.external.variables
					if (!externalsMatch(collectExternals(node), vars)) continue
					const cr = reconstructCheck(b)
					entries.push({
						path,
						identifier: b.external.identifier,
						checkDefs: cr.defs,
						checkValue: cr.value,
						external: vars.length > 0
					})
				} catch {}
			if (entries.length)
				Capture.customErrors({
					method: aot.method,
					path: aot.path,
					slot,
					entries
				})
		}

		// Freeze each ObjectString/ArrayString inner codec so the sealed runtime
		// can reconstruct it typebox-free. If any inner can't freeze, emit a SHORT
		// `ic` (break) — the `innerCodecs` coverage need then refuses the seal.
		// form-B `!sealed` gate: build-only, pulls typebox/value + createMirror.
		if (!globalThis.__ELYSIA_SEALED__) {
			const stringCodecs = collectStringCodecNodes(this.schema as any)
			if (stringCodecs.length) {
				const entries: NonNullable<
					CapturedValidator['innerCodecs']
				> = []
				for (const { inner, open, inArray } of stringCodecs) {
					const entry = captureInnerCodec(
						inner,
						open,
						inArray,
						options?.sanitize
					)
					if (!entry) break
					entries.push(entry)
				}
				if (entries.length === stringCodecs.length)
					Capture.innerCodecs({
						method: aot.method,
						path: aot.path,
						slot,
						entries
					})
			}
		}

		// @ts-expect-error private property
		const build = this.tb!.buildResult as CheckBuildResult
		if (!build?.functions?.length || !build.entry) return

		const variables = build.external.variables
		if (!externalsMatch(collectExternals(this.schema), variables)) return

		const r = reconstructCheck(build)
		Capture.validator({
			method: aot.method,
			path: aot.path,
			slot,
			identifier: build.external.identifier,
			checkDefs: r.defs,
			checkValue: r.value,
			external: variables.length > 0,
			async: variables.some(isAsyncPredicate),
			hasDefault: this.hasDefault,
			hasCodec: this.hasCodec,
			hasRef
		})
	}

	#dropCompiledSource(): void {
		const tb = this.tb as any
		if (!tb) return
		if (tb.evaluateResult) tb.evaluateResult.code = undefined
		if (tb.buildResult) tb.buildResult.functions = undefined
	}

	Errors(value: unknown): TLocalizedValidationError[] {
		// sealed: TypeBox `Errors` is dropped — production errors come from the
		// baked custom-error locator (error.ts), so the list degrades to empty
		return globalThis.__ELYSIA_SEALED__ ? [] : Errors(this.schema, value)
	}

	Decode(value: Static<T>): StaticDecode<T> {
		// frozen validators decode via the baked decode mirror, never this method
		return globalThis.__ELYSIA_SEALED__
			? (value as any)
			: Decode(this.schema, value)
	}

	Encode(value: Static<T>): StaticEncode<T> {
		return this.hasCodec && !globalThis.__ELYSIA_SEALED__
			? Encode(this.schema, value)
			: (value as any)
	}

	EncodeFrom(value: Static<T>, type?: string): StaticEncode<T> {
		if (this.#isForm) {
			if (!this.#noValidate && !this.Check(value))
				throw this.#verr(value, type)

			return value as any
		}

		if (!this.hasCodec) {
			if (!this.#noValidate && !this.Check(value))
				throw this.#verr(value, type)

			if (this.Clean) value = this.Clean(value) as Static<T>
			return value as any
		}

		try {
			if (this.#encodeMirror) {
				const out = this.#encodeMirror(value)

				if (!this.#noValidate && !this.Check(out as any))
					throw new ValidationError(
						type,
						out,
						() => this.Errors(out),
						this.schema
					)

				return out as any
			}

			// sealed: codec-response validators always carry a frozen encode
			// mirror (above), so this TypeBox Encode fallback DCEs out
			if (!globalThis.__ELYSIA_SEALED__) {
				const out = this.#noValidate
					? // @ts-ignore EncodeUnsafe returns unknown
						(EncodeUnsafe(nullObject(), this.schema, value) as any)
					: Encode(this.schema, value)
				return this.Clean ? (this.Clean(out) as any) : out
			}

			return value as any
		} catch (e: any) {
			if (this.#noValidate)
				return this.Clean ? (this.Clean(value) as any) : (value as any)

			if (e instanceof ValidationError) throw e
			if (e?.error) throw e.error
			if (e?.status) throw e

			throw new ValidationError(
				type,
				value,
				() => this.Errors(value),
				this.schema
			)
		}
	}

	#markForm(value: unknown): void {
		if (
			this.#isForm &&
			value !== null &&
			typeof value === 'object' &&
			!('~ely-form' in value)
		)
			Object.defineProperty(value, '~ely-form', {
				value: 1,
				configurable: true
			})
	}

	#unmarkForm(value: unknown): void {
		if (
			this.#isForm &&
			value !== null &&
			typeof value === 'object' &&
			'~ely-form' in value &&
			Object.getOwnPropertyDescriptor(value, '~ely-form')?.configurable
		)
			delete (value as Record<string, unknown>)['~ely-form']
	}

	From(value: Static<T>, type?: string): MaybePromise<Static<T>> {
		return this.isAsync
			? this.FromAsync(value, type)
			: this.FromSync(value, type)
	}

	// Apply baked ObjectString/ArrayString inner defaults at their value-paths.
	// Only the OBJECT-branch case (the field is a present object) — runs in the
	// default step BEFORE Check (matching TypeBox Default→Check order).
	#applyInnerDefaults(value: any): any {
		if (this.#innerDefaults === undefined) return value

		for (const { path, pod } of this.#innerDefaults) {
			if (path.length === 0) {
				if (
					value &&
					typeof value === 'object' &&
					!Array.isArray(value)
				)
					value = applyPrecomputed(pod, value)
				continue
			}

			let cur = value
			for (let i = 0; i < path.length - 1; i++) {
				if (cur === null || typeof cur !== 'object') {
					cur = undefined
					break
				}
				cur = cur[path[i]]
			}
			if (cur === null || typeof cur !== 'object') continue

			const key = path[path.length - 1]!
			const target = cur[key]
			if (target && typeof target === 'object' && !Array.isArray(target))
				cur[key] = applyPrecomputed(pod, target)
		}

		return value
	}

	#cloneSharedDefault(): unknown {
		const value = this.#precomputedDefault
		if (value === null || typeof value !== 'object') return value

		// Always deep-clone: the shared template (baked `pd` or the runtime
		// snapshot) must yield an independent instance per request.
		return structuredClone(value)
	}

	private optionalBypass(
		value: Static<T>
	): { bypass: true; value: Static<T> } | undefined {
		const schema = this.schema as any
		if (!schema?.['~optional']) return undefined

		if (value === undefined || value === null)
			return {
				bypass: true,
				value: (schema['~kind'] === 'Object'
					? nullObject()
					: value) as Static<T>
			}

		if (
			schema['~kind'] === 'Object' &&
			typeof value === 'object' &&
			!Array.isArray(value) &&
			Object.keys(value as object).length === 0
		)
			return { bypass: true, value: nullObject() as Static<T> }

		return undefined
	}

	async FromAsync(value: Static<T>, type?: string): Promise<Static<T>> {
		if (this.hasDefault) {
			if (this.precomputeSafe) {
				if (value === undefined || value === null)
					value = this.#cloneSharedDefault() as any
				else if (
					this.#precomputedObjectDefault !== undefined &&
					typeof value === 'object' &&
					!Array.isArray(value)
				)
					value = applyPrecomputed(
						this.#precomputedObjectDefault,
						value as any
					) as any
			} else if (!globalThis.__ELYSIA_SEALED__)
				value = Default(this.schema, value) as any
		}

		if (this.#innerDefaults) value = this.#applyInnerDefaults(value)

		if (this.#hasOptional) {
			const bypass = this.optionalBypass(value)
			if (bypass) return bypass.value
		}

		if (this.#isForm) this.#markForm(value)

		if (this.hasCodec) {
			if (!this.#noValidate) {
				collectFileTypeChecks()
				const valid = this.Check(value)
				const pendingFile = takeFileTypeChecks()
				if (!valid) throw this.#verr(value, type)
				if (pendingFile)
					await enforceFileTypeChecks(
						pendingFile,
						type,
						value,
						this.schema
					)
			}

			if (this.#decodeMirror)
				value = this.#decodeMirror(value) as Static<T>
			else if (!globalThis.__ELYSIA_SEALED__)
				try {
					value = DecodeUnsafe(
						nullObject() as {},
						this.schema,
						value
					) as Static<T>
				} catch (e: any) {
					if (e instanceof ValidationError) throw e
					if (e?.error) throw e.error
					if (e?.status) throw e

					throw new ValidationError(
						type,
						value,
						() => this.Errors(value),
						this.schema
					)
				}
		} else if (!this.#noValidate) {
			collectFileTypeChecks()
			const valid = this.Check(value)
			const pendingFile = takeFileTypeChecks()
			if (!valid) throw this.#verr(value, type)
			if (pendingFile)
				await enforceFileTypeChecks(
					pendingFile,
					type,
					value,
					this.schema
				)
		}

		if (this.Clean && !this.#decodeMirror)
			value = this.Clean(value) as Static<T>

		if (this.#isForm) this.#unmarkForm(value)
		return value
	}

	FromSync(value: Static<T>, type?: string): Static<T> {
		if (this.hasDefault) {
			if (this.precomputeSafe) {
				if (value === undefined || value === null)
					value = this.#cloneSharedDefault() as Static<T>
				else if (
					this.#precomputedObjectDefault !== undefined &&
					typeof value === 'object' &&
					!Array.isArray(value)
				)
					value = applyPrecomputed(
						this.#precomputedObjectDefault,
						value as any
					) as Static<T>
			} else if (!globalThis.__ELYSIA_SEALED__)
				value = Default(this.schema, value) as Static<T>
		}

		if (this.#innerDefaults) value = this.#applyInnerDefaults(value)

		if (this.#hasOptional) {
			const bypass = this.optionalBypass(value)
			if (bypass) return bypass.value
		}

		if (this.#isForm) this.#markForm(value)

		if (this.hasCodec) {
			// See FromAsync for the rationale on skipping `Convert`
			if (!this.#noValidate && !this.Check(value))
				throw this.#verr(value, type)
			if (this.#decodeMirror)
				value = this.#decodeMirror(value) as Static<T>
			else if (!globalThis.__ELYSIA_SEALED__)
				try {
					value = DecodeUnsafe(
						nullObject() as {},
						this.schema,
						value
					) as Static<T>
				} catch (e: any) {
					if (e instanceof ValidationError) throw e
					if (e?.error) throw e.error
					if (e?.status) throw e

					throw new ValidationError(
						type,
						value,
						() => this.Errors(value),
						this.schema
					)
				}
		} else {
			if (!this.#noValidate && !this.Check(value))
				throw this.#verr(value, type)
		}

		if (this.Clean && !this.#decodeMirror)
			value = this.Clean(value) as Static<T>

		if (this.#isForm) this.#unmarkForm(value)
		return value
	}
}

const DEFAULT_CACHE_LIMIT = 1024
const DEFAULT_GC_TIME = 1 * 60 * 1000

export class TypeBoxValidatorCache {
	private static EMPTY = nullObject() as {}
	private static ignoreKeys = new Set([
		'title',
		'description',
		'tags',
		'examples',
		'defaultValue'
	])
	private static fnIds = new WeakMap<Function, number>()
	private static nextFnId = 0

	private static fnKey(fn: Function): string {
		let id = TypeBoxValidatorCache.fnIds.get(fn)
		if (id === undefined) {
			id = ++TypeBoxValidatorCache.nextFnId
			TypeBoxValidatorCache.fnIds.set(fn, id)
		}
		return `<fn:${id}>`
	}

	static ignoreMeta(k: string, v: unknown): any {
		if (TypeBoxValidatorCache.ignoreKeys.has(k)) return undefined
		if (typeof v === 'function') return TypeBoxValidatorCache.fnKey(v)
		if (v && typeof v === 'object' && (v as any)['~optional'] === true) {
			const out = nullObject() as Record<string, unknown>
			for (const key in v as Record<string, unknown>)
				out[key] = (v as Record<string, unknown>)[key]
			out['~optional'] = true
			return out
		}
		return v
	}

	static #isOpaqueType(schema: any, seen = new WeakSet()): boolean {
		if (!schema || typeof schema !== 'object' || seen.has(schema))
			return false
		seen.add(schema)

		if (
			schema['~refine'] ||
			schema['~elyTyp'] === ELYSIA_TYPES.NoValidate
		)
			return true

		const props = schema.properties
		if (props)
			for (const k in props)
				if (TypeBoxValidatorCache.#isOpaqueType(props[k], seen))
					return true

		const items = schema.items
		if (Array.isArray(items)) {
			for (const it of items)
				if (TypeBoxValidatorCache.#isOpaqueType(it, seen)) return true
		} else if (items && TypeBoxValidatorCache.#isOpaqueType(items, seen))
			return true

		for (const k of ['anyOf', 'allOf', 'oneOf'] as const) {
			const arr = schema[k]
			if (Array.isArray(arr))
				for (const x of arr)
					if (TypeBoxValidatorCache.#isOpaqueType(x, seen)) return true
		}

		if (
			schema.additionalProperties &&
			typeof schema.additionalProperties === 'object' &&
			TypeBoxValidatorCache.#isOpaqueType(schema.additionalProperties, seen)
		)
			return true

		if (schema.not && TypeBoxValidatorCache.#isOpaqueType(schema.not, seen))
			return true

		const pp = schema.patternProperties
		if (pp)
			for (const k in pp)
				if (TypeBoxValidatorCache.#isOpaqueType(pp[k], seen)) return true

		return false
	}

	#cache = new Map<
		string,
		WeakMap<
			CoerceOption[] | typeof TypeBoxValidatorCache.EMPTY,
			BaseTypeBoxValidator
		>
	>()
	#referenceCache = new WeakMap<
		TSchema,
		WeakMap<
			CoerceOption[] | typeof TypeBoxValidatorCache.EMPTY,
			BaseTypeBoxValidator
		>
	>()

	#gc: ReturnType<typeof setTimeout> | undefined
	#gcTime: number

	#lastSchema: TSchema | undefined
	#lastMeta: { special: boolean; key: string } | undefined

	#meta(schema: TSchema): { special: boolean; key: string } {
		if (this.#lastSchema === schema && this.#lastMeta) return this.#lastMeta

		// sealed: this cache is bypassed for frozen validators (never reaches
		// `#meta`), so the typebox/value `HasCodec` reference DCEs out
		const special =
			(globalThis.__ELYSIA_SEALED__ ? false : HasCodec(schema)) ||
			TypeBoxValidatorCache.#isOpaqueType(schema)
		const meta = {
			special,
			key: special
				? ''
				: JSON.stringify(schema, TypeBoxValidatorCache.ignoreMeta)
		}

		this.#lastSchema = schema
		this.#lastMeta = meta

		return meta
	}

	constructor(gcTime = DEFAULT_GC_TIME) {
		this.#gcTime = gcTime
	}

	#scheduleClear(): void {
		if (isCloudflareWorker) return
		if (this.#gc) clearTimeout(this.#gc)
		this.#gc = setTimeout(() => this.clear(), this.#gcTime)
		;(this.#gc as any).unref?.()
	}

	get(
		schema: TSchema,
		coercions:
			| CoerceOption[]
			| typeof TypeBoxValidatorCache.EMPTY = TypeBoxValidatorCache.EMPTY
	): BaseTypeBoxValidator | undefined {
		if (this.#referenceCache.has(schema)) {
			const coercionsCache = this.#referenceCache.get(schema)!
			if (coercionsCache.has(coercions))
				return coercionsCache.get(coercions)
		}

		const { special, key } = this.#meta(schema)
		if (special) return undefined

		if (this.#cache.has(key)) {
			const coercionsCache = this.#cache.get(key)!
			this.#cache.delete(key)
			this.#cache.set(key, coercionsCache)
			if (coercionsCache.has(coercions))
				return coercionsCache.get(coercions)
		}

		return undefined
	}

	set(
		schema: TSchema,
		coercions:
			| CoerceOption[]
			| typeof TypeBoxValidatorCache.EMPTY = TypeBoxValidatorCache.EMPTY,
		validator?: BaseTypeBoxValidator
	): void {
		this.#scheduleClear()
		const { special, key } = this.#meta(schema)

		if (special) {
			const cache = new WeakMap().set(coercions, validator) as WeakMap<
				CoerceOption[] | typeof TypeBoxValidatorCache.EMPTY,
				BaseTypeBoxValidator
			>
			this.#referenceCache.set(schema, cache)
			return
		}

		if (this.#cache.has(key)) {
			const cache = this.#cache.get(key)!.set(coercions, validator!)
			if (this.#referenceCache.has(schema))
				this.#referenceCache.get(schema)!.set(coercions, validator!)
			else this.#referenceCache.set(schema, cache)
			return
		}

		if (this.#cache.size >= DEFAULT_CACHE_LIMIT) {
			const oldest = this.#cache.keys().next().value
			if (oldest !== undefined) this.#cache.delete(oldest)
		}

		const cache = new WeakMap().set(coercions, validator) as WeakMap<
			CoerceOption[] | typeof TypeBoxValidatorCache.EMPTY,
			BaseTypeBoxValidator
		>
		this.#cache.set(key, cache)
		this.#referenceCache.set(schema, cache)
	}

	clear(): void {
		if (this.#gc) {
			clearTimeout(this.#gc)
			this.#gc = undefined
		}
		this.#cache.clear()
		this.#referenceCache = new WeakMap()
		deferCoercions()
	}
}
