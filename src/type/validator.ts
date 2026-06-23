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
	buildCoercedFromPlan,
	captureCoercePlan,
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
	instantiateFrozenBoth,
	collectExternals,
	externalsMatch,
	reconstructCheck,
	EMPTY_EXTERNALS,
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
	if (props)
		for (const k in props)
			if (schemaContainsRef(props[k], seen)) return true

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

// Fast path for the standalone-guard merge: when every member is a plain inline
// object (own keys ⊆ type/properties/required, no `~elyTyp`)
function divergesFromEvaluate(node: any, seen: WeakSet<object>) {
	if (!node || typeof node !== 'object' || seen.has(node)) return false
	seen.add(node)

	for (const k in node) {
		if (!Object.hasOwn(node, k)) return true
		const v = (node as any)[k]
		if (typeof v === 'object' && v && divergesFromEvaluate(v, seen))
			return true
	}

	return false
}

const SIMPLE_OBJECT_KEYS = new Set(['type', 'properties', 'required'])
export function shallowMergeObjects(members: any[]): TSchema | null {
	const properties: Record<string, unknown> = {}
	let required: string[] | undefined

	for (const m of members) {
		if (
			!m ||
			m['~kind'] !== 'Object' ||
			m['~elyTyp'] !== undefined ||
			!m.properties ||
			divergesFromEvaluate(m, new WeakSet())
		)
			return null

		for (const k of Object.keys(m))
			if (!SIMPLE_OBJECT_KEYS.has(k)) return null

		for (const k in m.properties) {
			if (k in properties) return null // Evaluate intersects overlaps
			properties[k] = m.properties[k]
		}

		if (Array.isArray(m.required) && m.required.length)
			(required ??= []).push(...m.required)
	}

	const out: any = { type: 'object', properties }
	if (required) out.required = required

	return Object.defineProperty(out, '~kind', {
		value: 'Object',
		enumerable: false
	}) as TSchema
}

let inlineRefId = 0

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
	if (!value || typeof value !== 'object') return

	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			const found = findInstancePath(value[i], target, `${path}/${i}`)
			if (found !== undefined) return found
		}

		return
	}

	for (const key in value) {
		const found = findInstancePath(
			(value as Record<string, unknown>)[key],
			target,
			`${path}/${key}`
		)
		if (found !== undefined) return found
	}
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

	if (schema['~codec'] || schema['~refine']) return false

	// Nested Object without its own default = not preallocatable.
	if (depth > 0 && (kind === 'Object' || schema.type === 'object'))
		if (schema.default === undefined || nestedOwnDefaultDiverges(schema))
			return false

	if (schema.properties)
		for (const key in schema.properties)
			if (
				Object.hasOwn(schema.properties, key) &&
				!isPrecomputeSafe(schema.properties[key], depth + 1)
			)
				return false

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
		for (const key in schema.patternProperties)
			if (
				Object.hasOwn(schema.patternProperties, key) &&
				!isPrecomputeSafe(schema.patternProperties[key], depth + 1)
			)
				return false

	return true
}

// A nested Object WITH its own `default` is precompute-safe only when that
// own default agrees, field by field, with the defaults its children would
// fill in
function nestedOwnDefaultDiverges(objectSchema: any) {
	const own = objectSchema.default
	if (own === null || typeof own !== 'object' || Array.isArray(own))
		return false

	const props = objectSchema.properties
	if (!props) return false

	for (const key in props) {
		const child = props[key]
		if (!child || typeof child !== 'object') continue

		if ('default' in child) {
			if (
				!(key in own) ||
				canonical((own as any)[key]) !== canonical(child.default)
			)
				return true
		} else if (child['~kind'] === 'Object' || child.type === 'object') {
			if (key in own) {
				if (
					nestedOwnDefaultDiverges({
						...child,
						default: (own as any)[key]
					})
				)
					return true
			} else if (hasDefaultBelow(child)) return true
		}
	}

	return false
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
		for (const k in n.patternProperties)
			if (f(n.patternProperties[k])) return true

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

// ? build-time, check if a default is preallocatable (emittable, JSON-serializable)
function verifyPreallocatableDefault(schema: TSchema) {
	// preallocated default
	let pd: unknown
	// preallocatable object default raw
	let podRaw: unknown

	try {
		pd = Default(schema, undefined)
		podRaw = Default(schema, nullObject())
	} catch {
		return
	}

	const pod =
		podRaw && typeof podRaw === 'object' && !Array.isArray(podRaw)
			? (podRaw as Record<string, unknown>)
			: undefined

	if (
		!isEmittable(pd, new Set(), true) ||
		(pod !== undefined && !isEmittable(pod, new Set(), true))
	)
		return

	if (!isPrecomputeSafe(schema as any)) {
		const s = schema as any

		if (s.type !== 'object' && s['~kind'] !== 'Object') return
		if (!structuralPreallocatable(schema as any)) return

		for (const probe of defaultProbes(pod)) {
			let expected: unknown

			try {
				expected = Default(schema, structuredClone(probe))
			} catch {
				return
			}

			const actual = applyPrecomputed(pod!, structuredClone(probe))
			if (canonical(expected) !== canonical(actual)) return
		}
	}

	return { pd, pod }
}

interface CustomErrorNode {
	path: string
	node: any
	each?: boolean
	// Nearest enclosing union (anyOf/oneOf)
	union?: { node: any; path: string }
}

function collectCustomErrorNodes(
	schema: any,
	path: string,
	out: CustomErrorNode[],
	union?: { node: any; path: string }
) {
	if (!schema || typeof schema !== 'object') return out
	if (schema.error !== undefined) out.push({ path, node: schema, union })
	if (schema.properties)
		for (const k in schema.properties)
			collectCustomErrorNodes(
				schema.properties[k],
				path + '/' + k,
				out,
				union
			)

	const items = schema.items
	if (Array.isArray(items)) {
		// Tuple: every element has a fixed index, so it is value-addressable
		for (let i = 0; i < items.length; i++)
			collectCustomErrorNodes(items[i], path + '/' + i, out, union)
	} else if (items && items.error !== undefined)
		out.push({ path, node: items, each: true, union })

	const branches = schema.anyOf ?? schema.oneOf
	if (Array.isArray(branches)) {
		const gate = { node: schema, path }
		for (const branch of branches)
			collectCustomErrorNodes(branch, path, out, gate)
	}

	return out
}

function subValueAt(value: any, path: string): unknown {
	if (!path) return value
	let cur = value

	for (const part of path.split('/')) {
		if (!part) continue
		if (cur === null || typeof cur !== 'object') return
		cur = cur[part]
	}

	return cur
}

// capture ObjectString/ArrayString inner codecs. The traversal order is the
// capture↔reconstruct contract: `ic[i]` aligns 1:1 with `nodes[i]` (reconstruct
// iterates in REVERSE for bottom-up overwrite), so keep self → properties →
// items → anyOf.
interface StringCodecNode {
	inner: any
	codec: any
	open: number
}

function collectStringCodecNodes(
	schema: any,
	out: StringCodecNode[] = []
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
				open: ely === ELYSIA_TYPES.ObjectString ? 123 : 91
			})
	}

	if (schema.properties)
		for (const k in schema.properties)
			collectStringCodecNodes(schema.properties[k], out)

	const items = schema.items
	if (Array.isArray(items)) {
		for (const it of items) collectStringCodecNodes(it, out)
	} else if (items) collectStringCodecNodes(items, out)

	if (Array.isArray(schema.anyOf))
		for (const b of schema.anyOf) collectStringCodecNodes(b, out)

	return out
}

// reconstruct seal: overwrite each ObjectString/ArrayString codec's
// `~refine[0].check` + `~codec.decode` with frozen, typebox-free closures.
// Iterate in REVERSE so nested codecs reconstruct bottom-up.
function reconstructInnerCodecs(
	ic: NonNullable<FrozenValidator['ic']>,
	schema: any
): void {
	const nodes = collectStringCodecNodes(schema)

	for (let i = nodes.length - 1; i >= 0; i--) {
		const entry = ic[i]
		const node = nodes[i]
		if (!entry || !node) continue

		const innerSchema = node.inner
		const innerCheck = entry.c(entry.e ? collectExternals(innerSchema) : [])
		const innerMirror = entry.d.x
			? instantiateFrozenDecodeMirror(entry.d, innerSchema)
			: (entry.d.s as (value: unknown) => unknown)

		const open = entry.o
		node.codec['~refine'][0].check = (v: string) => {
			if (v.charCodeAt(0) !== open) return false

			try {
				return innerCheck(JSON.parse(v))
			} catch {
				return false
			}
		}

		node.codec['~codec'].decode = (v: string) => innerMirror(JSON.parse(v))
	}
}

function externalsShape(schema: unknown) {
	let out = ''
	for (const e of collectExternals(schema))
		out += e instanceof RegExp ? 'r' : typeof e === 'function' ? 'f' : 'v'

	return out
}

function buildFrozenCheck(
	build: CheckBuildResult | undefined,
	node: any
):
	| {
			identifier: string
			checkDefs: string
			checkValue: string
			external: boolean
	  }
	| undefined {
	if (!build?.functions?.length || !build.entry) return
	const vars = build.external.variables

	if (!externalsMatch(collectExternals(node), vars)) return
	const cr = reconstructCheck(build)

	return {
		identifier: build.external.identifier,
		checkDefs: cr.defs,
		checkValue: cr.value,
		external: vars.length > 0
	}
}

// Build time: freeze one ObjectString/ArrayString inner schema into a check
// (reconstructCheck source) + decode mirror (exact-mirror)
function captureInnerCodec(
	inner: any,
	open: number,
	sanitize: ValidatorOptions['sanitize']
): NonNullable<CapturedValidator['innerCodecs']>[number] | undefined {
	let cf: ReturnType<typeof buildFrozenCheck>
	try {
		cf = buildFrozenCheck(
			Build(inner) as unknown as CheckBuildResult,
			inner
		)
		if (!cf) return
	} catch {
		return
	}

	let decode: CapturedMirror
	try {
		const emitted = createMirror(inner, {
			Compile,
			sanitize,
			decode: true,
			emit: true
		}) as { source?: string; externals?: any }

		if (typeof emitted?.source !== 'string') return
		const ext = emitted.externals

		if (ext?.hof) return
		if (ext?.codecs && !Capture.mirrorCodecs(inner, ext.codecs)) return

		let u: { identifier: string; code: string }[][] | undefined
		if (ext?.unions && ext.unions.length) {
			u = Capture.mirrorUnions(inner, ext.unions)
			if (!u) return
		}

		decode = {
			source: emitted.source,
			hasExternals: !!(ext?.codecs || u),
			u
		}
	} catch {
		return
	}

	// inner defaults aren't reconstructed under seal → refuse this slot so the
	// route degrades to TypeBox (which fills the default at runtime)
	if (hasProperty('default', inner)) return

	return { open, ...cf, decode }
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

		if (isIntersectable) {
			const members = [schema, ...options!.schemas!]
			// fast path because Evaluate(Intersect(...)) is deep clone
			schema = (shallowMergeObjects(members) ??
				Evaluate(Intersect(members as any))) as unknown as T
		}

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
			schemaHasRef = frozen ? frozen.r === 1 : schemaContainsRef(schema)
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
			isFrozen && frozen!.cp
				? // bake: splice deduped frozen leaves into the live original
					// schema instead of re-walking (see coerce.ts captureCoercePlan)
					buildCoercedFromPlan(schema as any, frozen!.cp)
				: isFrozen && !this.hasCodec
					? schema
					: applyCoercions(schema as any, options?.coerces)
		) as T

		if (
			options?.normalize === false &&
			options.slot !== 'headers' &&
			options.slot !== 'cookie'
		)
			this.schema = nonAdditionalProperties(this.schema as any) as T

		if (!isFrozen) {
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

			if (capturing) this.#maybeCapture(options, schemaHasRef, schema)
			else this.#dropCompiledSource()
		}

		if (frozen?.ps === 1) {
			this.precomputeSafe = true
			this.#precomputedDefault = frozen.pd
			this.#precomputedObjectDefault =
				frozen.pod !== undefined
					? (Object.freeze(frozen.pod) as Record<string, unknown>)
					: undefined
		} else {
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

		if (frozen?.ic) reconstructInnerCodecs(frozen.ic, this.schema)

		if (isFrozen && frozen!.cm) {
			const both = instantiateFrozenBoth(frozen!, this.schema, schema)
			this.reconstructedCheck = both.check
			this.Clean = options?.normalize === false ? undefined : both.clean
		} else {
			if (isFrozen)
				this.reconstructedCheck = frozen!.c!(
					frozen!.e ? collectExternals(this.schema) : EMPTY_EXTERNALS
				)

			try {
				this.Clean =
					options?.normalize === false
						? undefined
						: options?.normalize === 'typebox'
							? (value) => Clean(this.schema, value)
							: this.#setupMirror(schema, options, frozen)
			} catch (error) {
				console.warn(
					'Failed to create exactMirror. Please report the following code to https://github.com/elysiajs/elysia/issues'
				)
				console.warn(schema)
				console.warn(error)

				if (options?.normalize !== false)
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
			this.#decodeMirror = this.#setupCodecMirror(
				this.schema as TSchema,
				options,
				frozen,
				'decode'
			)

		if (
			this.hasCodec &&
			!this.#isForm &&
			!this.#noValidate &&
			options?.slot?.startsWith('r') &&
			options?.normalize !== false &&
			options?.normalize !== 'typebox'
		)
			this.#encodeMirror = this.#setupCodecMirror(
				this.schema as TSchema,
				options,
				frozen,
				'encode'
			)

		if (!this.#noValidate)
			this.#findCustomError = this.#buildFindCustomError(frozen)
	}

	#buildFindCustomError(
		frozen?: FrozenValidator
	):
		| ((
				value: unknown
		  ) => { instancePath: string; error: unknown } | undefined)
		| undefined {
		const nodes = collectCustomErrorNodes(this.schema as any, '', [])
		if (!nodes.length) return

		const frozenByPath = frozen?.ce
			? new Map(frozen.ce.map((e) => [e.p, e]))
			: undefined

		const checks: {
			path: string
			check: (v: unknown) => boolean
			gate?: (root: unknown) => boolean
			error: unknown
		}[] = []

		for (const { path, node, each, union } of nodes) {
			let check: ((v: unknown) => boolean) | undefined

			// Union-branch nodes must not reuse a frozen `ce` entry
			const fe = union ? undefined : frozenByPath?.get(path)
			if (fe)
				try {
					check = fe.c(
						fe.e ? collectExternals(node) : EMPTY_EXTERNALS
					)
				} catch {}
			else
				try {
					const c = Compile(node)
					check = (v) => c.Check(v)
				} catch {}

			if (check && each) {
				const elementCheck = check
				check = (v) =>
					!Array.isArray(v) || v.every((x) => elementCheck(x))
			}

			if (!check) continue

			let gate: ((root: unknown) => boolean) | undefined
			if (union) {
				let unionCheck: ((v: unknown) => boolean) | undefined
				try {
					const uc = Compile(union.node)
					unionCheck = (v) => uc.Check(v)
				} catch {}

				if (!unionCheck) continue

				// copy string
				const unionPath = union.path
				gate = (root) => unionCheck!(subValueAt(root, unionPath))
			}

			checks.push({ path, check, gate, error: node.error })
		}

		if (!checks.length) return

		checks.sort((a, b) => b.path.length - a.path.length)

		return (value) => {
			for (const c of checks) {
				if (c.gate && c.gate(value)) continue
				if (!c.check(subValueAt(value, c.path)))
					return { instancePath: c.path, error: c.error }
			}
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

		if (aot && slot) {
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
							Capture.set(
								{ method: aot.method, path: aot.path, slot },
								{
									mirror: {
										source: emitted.source,
										hasExternals: false
									}
								}
							)
						else if (ext.unions && !ext.hof) {
							const u = Capture.mirrorUnions(schema, ext.unions)

							if (u)
								Capture.set(
									{
										method: aot.method,
										path: aot.path,
										slot
									},
									{
										mirror: {
											source: emitted.source,
											hasExternals: true,
											u
										}
									}
								)
						}
					}
				} catch {}
		}

		return createMirror(schema, {
			Compile,
			sanitize: options?.sanitize
		}) as (value: unknown) => unknown
	}

	// decode (request) / encode (response) codec mirror. Frozen → instantiate
	// lazily (with a JIT fallback when unsealed); else capture the emit + JIT.
	#setupCodecMirror(
		schema: TSchema,
		options: ValidatorOptions | undefined,
		frozen: FrozenValidator | undefined,
		dir: 'decode' | 'encode'
	): ((value: unknown) => unknown) | undefined {
		const aot = options?.aot
		const slot = options?.slot
		const frozenMirror = dir === 'decode' ? frozen?.dm : frozen?.em

		if (aot && slot && frozenMirror) {
			const m = frozenMirror
			let run: ((value: unknown) => unknown) | undefined

			return (value: unknown) => {
				if (run === undefined)
					try {
						run = instantiateFrozenDecodeMirror(m, schema, dir)
					} catch {
						run =
							dir === 'decode'
								? (v) => {
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
								: (v) => {
										const out = Encode(schema, v as any)
										return this.Clean
											? this.Clean(out)
											: out
									}
					}

				return run(value)
			}
		}

		const dirOpt = dir === 'decode' ? { decode: true } : { encode: true }

		// decode freezes non-response slots, encode freezes response slots
		const captureSlot =
			dir === 'decode'
				? !slot?.startsWith('response')
				: !!slot?.startsWith('response')

		if (aot && slot && Capture.isCapturing() && captureSlot)
			try {
				const emitted = createMirror(schema, {
					Compile,
					sanitize: options?.sanitize,
					...dirOpt,
					emit: true
				}) as { source?: string; externals?: any }

				if (typeof emitted?.source === 'string') {
					const ext = emitted.externals

					if (
						ext?.codecs &&
						!ext.hof &&
						Capture.mirrorCodecs(schema, ext.codecs, dir)
					) {
						let u:
							| { identifier: string; code: string }[][]
							| undefined
						let freezable = true

						if (ext.unions && ext.unions.length) {
							u = Capture.mirrorUnions(schema, ext.unions)
							if (!u) freezable = false
						}

						if (freezable) {
							const mirror = {
								source: emitted.source,
								hasExternals: true,
								u
							}
							Capture.set(
								{ method: aot.method, path: aot.path, slot },
								dir === 'decode'
									? { decodeMirror: mirror }
									: { encodeMirror: mirror }
							)
						}
					}
				}
			} catch {}

		try {
			return createMirror(schema, {
				Compile,
				sanitize: options?.sanitize,
				...dirOpt
			}) as (value: unknown) => unknown
		} catch {}
	}

	Check(value: Static<T>): boolean {
		if (this.reconstructedCheck) return this.reconstructedCheck(value)

		return this.tb!.Check(value)
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
		hasRef: boolean,
		originalSchema: TSchema
	): void {
		const aot = options?.aot
		const slot = options?.slot
		if (!aot || !slot || !Capture.isCapturing()) return

		if (
			this.hasCodec &&
			!hasRef &&
			options.coerces &&
			options.normalize !== false &&
			options.normalize !== 'typebox'
		) {
			const plan = captureCoercePlan(originalSchema, this.schema)
			if (
				plan &&
				externalsShape(buildCoercedFromPlan(originalSchema, plan)) ===
					externalsShape(this.schema)
			)
				Capture.set(
					{ method: aot.method, path: aot.path, slot },
					{ coercePlan: plan }
				)
		}

		if (this.hasDefault) {
			const pre = verifyPreallocatableDefault(this.schema as TSchema)
			if (pre)
				Capture.set(
					{ method: aot.method, path: aot.path, slot },
					{
						precomputeSafe: true,
						precomputedDefault: pre.pd,
						precomputedObjectDefault: pre.pod
					}
				)
		}

		const ceNodes = collectCustomErrorNodes(this.schema as any, '', [])
		if (ceNodes.length) {
			const entries: NonNullable<CapturedValidator['customErrors']> = []
			for (const { path, node, union } of ceNodes) {
				if (union) continue

				try {
					const cf = buildFrozenCheck(
						Build(node) as unknown as CheckBuildResult,
						node
					)
					if (cf) entries.push({ path, ...cf })
				} catch {}
			}
			if (entries.length)
				Capture.set(
					{ method: aot.method, path: aot.path, slot },
					{ customErrors: entries }
				)
		}

		const stringCodecs = collectStringCodecNodes(this.schema as any)
		if (stringCodecs.length) {
			const entries: NonNullable<CapturedValidator['innerCodecs']> = []

			for (const { inner, open } of stringCodecs) {
				const entry = captureInnerCodec(inner, open, options?.sanitize)
				if (!entry) break
				entries.push(entry)
			}

			if (entries.length === stringCodecs.length)
				Capture.set(
					{ method: aot.method, path: aot.path, slot },
					{ innerCodecs: entries }
				)
		}

		// @ts-expect-error private property
		const build = this.tb!.buildResult as CheckBuildResult
		const cf = buildFrozenCheck(build, this.schema)
		if (!cf) return

		Capture.set(
			{ method: aot.method, path: aot.path, slot },
			{
				...cf,
				async: build.external.variables.some(isAsyncPredicate),
				hasDefault: this.hasDefault,
				hasCodec: this.hasCodec,
				hasRef
			}
		)
	}

	#dropCompiledSource(): void {
		const tb = this.tb as any
		if (!tb) return
		if (tb.evaluateResult) tb.evaluateResult.code = undefined
		if (tb.buildResult) tb.buildResult.functions = undefined
	}

	Errors(value: unknown): TLocalizedValidationError[] {
		return Errors(this.schema, value)
	}

	Decode(value: Static<T>): StaticDecode<T> {
		return Decode(this.schema, value)
	}

	Encode(value: Static<T>): StaticEncode<T> {
		return this.hasCodec ? Encode(this.schema, value) : (value as any)
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

			const out = this.#noValidate
				? // @ts-ignore EncodeUnsafe returns unknown
					(EncodeUnsafe(nullObject(), this.schema, value) as any)
				: Encode(this.schema, value)

			return this.Clean ? (this.Clean(out) as any) : out
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

	#markForm(value: unknown) {
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

	#unmarkForm(value: unknown) {
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

	// Apply baked ObjectString/ArrayString inner defaults at their value-paths
	#cloneSharedDefault() {
		const value = this.#precomputedDefault
		if (value === null || typeof value !== 'object') return value

		// Always deep-clone: the shared template (baked `pd` or the runtime
		// snapshot) must yield an independent instance per request
		return structuredClone(value)
	}

	private optionalBypass(
		value: Static<T>
	): { bypass: true; value: Static<T> } | undefined {
		const schema = this.schema as any
		if (!schema?.['~optional']) return

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
			} else value = Default(this.schema, value) as any
		}

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
			else
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
			} else value = Default(this.schema, value) as Static<T>
		}

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
			else
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
		if (TypeBoxValidatorCache.ignoreKeys.has(k)) return

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

		if (schema['~refine'] || schema['~elyTyp'] === ELYSIA_TYPES.NoValidate)
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
					if (TypeBoxValidatorCache.#isOpaqueType(x, seen))
						return true
		}

		if (
			schema.additionalProperties &&
			typeof schema.additionalProperties === 'object' &&
			TypeBoxValidatorCache.#isOpaqueType(
				schema.additionalProperties,
				seen
			)
		)
			return true

		if (schema.not && TypeBoxValidatorCache.#isOpaqueType(schema.not, seen))
			return true

		const pp = schema.patternProperties
		if (pp)
			for (const k in pp)
				if (TypeBoxValidatorCache.#isOpaqueType(pp[k], seen))
					return true

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
		Map<
			string,
			WeakMap<
				CoerceOption[] | typeof TypeBoxValidatorCache.EMPTY,
				BaseTypeBoxValidator
			>
		>
	>()

	#gc: ReturnType<typeof setTimeout> | undefined
	#gcTime: number

	#lastSchema: TSchema | undefined
	#lastMeta: { special: boolean; key: string } | undefined

	#meta(schema: TSchema): { special: boolean; key: string } {
		if (this.#lastSchema === schema && this.#lastMeta) return this.#lastMeta

		const special =
			HasCodec(schema) || TypeBoxValidatorCache.#isOpaqueType(schema)

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

	constructor(gcTime: number) {
		this.#gcTime = gcTime
	}

	#scheduleClear() {
		if (isCloudflareWorker) return

		if (this.#gc) clearTimeout(this.#gc)

		this.#gc = setTimeout(
			() => this.clear(),
			this.#gcTime ?? DEFAULT_GC_TIME
		)
		;(this.#gc as any).unref?.()
	}

	get(
		schema: TSchema,
		coercions:
			| CoerceOption[]
			| typeof TypeBoxValidatorCache.EMPTY = TypeBoxValidatorCache.EMPTY,
		normalize = ''
	) {
		const refBucket = this.#referenceCache.get(schema)?.get(normalize)
		if (refBucket?.has(coercions)) return refBucket.get(coercions)

		const meta = this.#meta(schema)
		if (meta.special) return

		const key = meta.key + '\0' + normalize
		if (this.#cache.has(key)) {
			const coercionsCache = this.#cache.get(key)!
			this.#cache.delete(key)
			this.#cache.set(key, coercionsCache)

			if (coercionsCache.has(coercions))
				return coercionsCache.get(coercions)
		}
	}

	#refBucket(schema: TSchema) {
		let byNormalize = this.#referenceCache.get(schema)
		if (!byNormalize) {
			byNormalize = new Map()
			this.#referenceCache.set(schema, byNormalize)
		}
		return byNormalize
	}

	set(
		schema: TSchema,
		coercions:
			| CoerceOption[]
			| typeof TypeBoxValidatorCache.EMPTY = TypeBoxValidatorCache.EMPTY,
		validator?: BaseTypeBoxValidator,
		normalize = ''
	) {
		this.#scheduleClear()
		const meta = this.#meta(schema)

		if (meta.special) {
			const cache = new WeakMap().set(coercions, validator) as WeakMap<
				CoerceOption[] | typeof TypeBoxValidatorCache.EMPTY,
				BaseTypeBoxValidator
			>
			this.#refBucket(schema).set(normalize, cache)
			return
		}

		const key = meta.key + '\0' + normalize
		if (this.#cache.has(key)) {
			const cache = this.#cache.get(key)!.set(coercions, validator!)
			const byNormalize = this.#refBucket(schema)
			if (byNormalize.has(normalize))
				byNormalize.get(normalize)!.set(coercions, validator!)
			else byNormalize.set(normalize, cache)
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
		this.#refBucket(schema).set(normalize, cache)
	}

	clear() {
		if (this.#gc) {
			clearTimeout(this.#gc)
			this.#gc = undefined
		}

		this.#cache.clear()
		this.#referenceCache = new WeakMap()
		deferCoercions()
	}
}
