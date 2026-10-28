import { Decode, Refine } from './typebox-type'

import { ELYSIA_TYPES } from './constants'
import { nullObject, evictOldestHalf } from '../utils'
import { cloneNode, coerceLeafCache, pureRefine } from './shared'

import { Numeric } from './elysia/numeric'
import { BooleanString } from './elysia/boolean-string'
import { IntegerString } from './elysia/integer-string'
import { ObjectType } from './elysia/object'
import { ArrayType } from './elysia/array'
import { StringType } from './elysia/string'
import { Union } from './elysia/union'
import { elyType, getMeta } from './elysia/utils'

export function carryRefine(original: any, leaf: any) {
	const refine = original?.['~refine']
	if (!refine) return leaf

	const value = leaf.anyOf[0]
	const codec = leaf.anyOf[1]['~codec']
	const decoded = (input: unknown) =>
		typeof input === 'string' &&
		value.const !== input &&
		!value.enum?.includes(input)
			? codec.decode(input)
			: input

	return Object.defineProperty(cloneNode(leaf, leaf), '~refine', {
		value: refine.map((refinement: any) => ({
			...refinement,
			check: (value: unknown) => refinement.check(decoded(value)),
			// the message sees the value the predicate saw
			error: (value: unknown) => refinement.error(decoded(value))
		}))
	})
}

export function carryCodec(original: any, leaf: any) {
	const codec = original?.['~codec']
	if (!codec) return leaf

	const withDecode = (branch: any, decode: (value: any) => unknown) =>
		Object.defineProperty(cloneNode(branch, branch), '~codec', {
			value: { decode, encode: codec.encode }
		})

	const [value, string] = leaf.anyOf
	const out = cloneNode(leaf, leaf)
	out.anyOf = [
		// t.Literal / t.Enum: the value branch is the codec node itself
		value['~codec'] ? value : withDecode(value, codec.decode),
		withDecode(string, (input) =>
			codec.decode(string['~codec'].decode(input))
		)
	]

	return out
}

export const acceptsEmpty = (node: any) =>
	(node.type === 'string' &&
		node.minLength === undefined &&
		node.pattern === undefined &&
		node.format === undefined &&
		node.const === undefined &&
		node.enum === undefined &&
		!node['~refine'] &&
		!node['~codec']) ||
	node.const === '' ||
	!!node.enum?.includes('') ||
	!!node.anyOf?.some(acceptsEmpty)

// t.MaybeEmpty in a string slot (query, headers, params, form): `?m=` is the
// empty value, decoded to `undefined` like an absent key
let emptyString: any
export const emptyAsUndefined = () =>
	(emptyString ??= Object.freeze(
		pureRefine(
			Decode(
				Refine(
					StringType(),
					(value) => value === '',
					() => 'must be empty'
				),
				() => undefined
			)
		)
	))

// a number/boolean t.Literal / t.Enum / t.UnionEnum in a string slot: the
// node itself, or its string form decoded back to the value
export function constString(original: any) {
	// registered for Literal / Enum / UnionEnum only: one of the two is set
	const values: unknown[] =
		'const' in original ? [original.const] : original.enum

	const map = new Map<string, unknown>()
	for (const value of values)
		if (typeof value === 'number' || typeof value === 'boolean')
			map.set(value + '', value)

	if (!map.size) return null

	return elyType(
		ELYSIA_TYPES.ConstString,
		Union([
			original,
			pureRefine(
				Decode(
					Refine(
						StringType(),
						(value) => map.has(value),
						() =>
							'const' in original
								? 'must be equal to constant'
								: 'must be equal to one of the allowed values'
					),
					(value) => map.get(value)
				)
			)
		])
	)
}

export const COERCE_LEAF_CTOR = {
	[ELYSIA_TYPES.Numeric]: Numeric,
	[ELYSIA_TYPES.Integer]: IntegerString,
	[ELYSIA_TYPES.BooleanString]: BooleanString,
	// from the captured `const` / `enum`
	[ELYSIA_TYPES.ConstString]: constString
} as const

export interface CoerceLeaf {
	// `~elyTyp` of the primitive coercion
	e: number
	// constraints bag passed to the leaf constructor (own-enumerable, minus `type`)
	c?: Record<string, unknown>
	// `~optional` marker to re-attach (coercion preserves it; the shared leaf can't)
	o?: unknown
}

export interface CoerceObjStr {
	// `~elyTyp`: ObjectString or ArrayString
	os: number
	// `~optional` marker to re-attach (symmetric with CoerceLeaf.o)
	o?: unknown
}

export interface CoerceUnion {
	// anyof per coercion (index → leaf / objstr / union / nested plan)
	u: (CoerceNode | null)[]
	// t.MaybeEmpty in a string slot: append `emptyAsUndefined` (not `e`, a
	// leaf's key)
	em?: 1
}

export type CoerceNode = CoerceLeaf | CoerceObjStr | CoerceUnion | CoercePlan

export interface CoercePlan {
	// per-property coercion (key → leaf / objstr / union / nested plan)
	p?: Record<string, CoerceNode>
	// single-schema array items coercion
	i?: CoerceNode
}

export const isCoerceLeaf = (x: CoerceNode): x is CoerceLeaf =>
	typeof (x as CoerceLeaf).e === 'number'

export const isCoerceObjStr = (x: CoerceNode): x is CoerceObjStr =>
	typeof (x as CoerceObjStr).os === 'number'

export const isCoerceUnion = (x: CoerceNode): x is CoerceUnion =>
	Array.isArray((x as CoerceUnion).u)

/** Rebuilds an ObjectString/ArrayString coercion site (see `coerce.ts`). */
export type RebuildObjStr = (original: any, site: CoerceObjStr) => any

const icPlaceholder = () => {
	throw new Error(
		'[elysia] ObjectString/ArrayString shape placeholder was not' +
			' reconstructed. missing inner-codec (ic) entry'
	)
}

// Shape twin of `coerce.ts` `rebuildObjStr`
// fresh nodes per rebuild, never cached: `reconstructInnerCodecs` mutates them in place
const rebuildObjStrShape: RebuildObjStr = (original, site) => {
	const { type, ...rest } = original
	const isObject = site.os === ELYSIA_TYPES.ObjectString

	let inner, meta
	if (isObject) {
		const [{ properties, ...constraints }, m] = getMeta(rest)
		inner = ObjectType(rest.properties ?? nullObject(), constraints)
		meta = m
	} else {
		const [constraints, m] = getMeta(rest)
		inner = ArrayType(rest.items ?? nullObject(), constraints)
		meta = m
	}

	// as coerce.ts `keepHidden`: the refine lives on the inner node
	if (original['~refine'])
		Object.defineProperty(inner, '~refine', { value: original['~refine'] })

	const node = elyType(
		isObject ? ELYSIA_TYPES.ObjectString : ELYSIA_TYPES.ArrayString,
		Union(
			[
				inner,
				Decode(
					Refine(StringType(), icPlaceholder, () =>
						isObject ? 'must be an object' : 'must be an array'
					),
					// one per node, the build gave each site its own `decode`
					() => icPlaceholder()
				)
			],
			meta
		)
	)

	if ('o' in site)
		return Object.defineProperty(node, '~optional', {
			value: site.o,
			enumerable: false
		})

	return node
}

function buildCoerceNode<T>(
	original: T,
	node: CoerceNode,
	seen: Set<string>,
	objStr: RebuildObjStr,
	memo: WeakMap<object, any>
): T {
	let out = memo.get(original as any)
	if (!out) {
		out = rebuildCoerceNode(original, node, seen, objStr, memo)
		if (original) memo.set(original, out)
	}

	return out
}

function rebuildCoerceNode<T>(
	original: T,
	node: CoerceNode,
	seen: Set<string>,
	objStr: RebuildObjStr,
	memo: WeakMap<object, any>
): T {
	if (isCoerceLeaf(node)) {
		const key = node.e + (node.c ? JSON.stringify(node.c) : '')

		let leaf: any
		if (seen.has(key)) {
			// @ts-expect-error
			leaf = COERCE_LEAF_CTOR[node.e]!(node.c)
		} else {
			seen.add(key)
			leaf = coerceLeafCache.get(key)
			if (leaf === undefined) {
				// @ts-expect-error
				leaf = COERCE_LEAF_CTOR[node.e]!(node.c)

				if (coerceLeafCache.size >= COERCE_LEAF_CACHE_LIMIT)
					evictOldestHalf(coerceLeafCache)

				coerceLeafCache.set(key, leaf)
			} else if (coerceLeafCache.size >= COERCE_LEAF_CACHE_LIMIT) {
				coerceLeafCache.delete(key)
				coerceLeafCache.set(key, leaf)
			}
		}

		// per use, the cached leaf is shared
		leaf = carryCodec(original, carryRefine(original, leaf))

		// per-use `~optional` wrapper (don't mutate the shared frozen leaf)
		if ('o' in node)
			return Object.defineProperty(Object.create(leaf), '~optional', {
				value: node.o,
				enumerable: false
			})

		return leaf
	}

	if (isCoerceObjStr(node)) return objStr(original, node)
	if (isCoerceUnion(node))
		return rebuildUnion(original, node, seen, objStr, memo)

	return buildCoercedFromPlan(original, node, seen, objStr, memo)
}

// clone `original` preserving prototype + non-enumerable markers
// (`~kind`, `~optional`, `~elyTyp`, ...)
function cloneSchemaNode(original: any) {
	const out = Object.create(Object.getPrototypeOf(original))

	for (const k in original) out[k] = original[k]

	for (const s of Object.getOwnPropertyNames(original)) {
		const d = Object.getOwnPropertyDescriptor(original, s)!
		if (!d.enumerable) Object.defineProperty(out, s, d)
	}

	return out
}

function rebuildUnion(
	original: any,
	site: CoerceUnion,
	seen: Set<string>,
	objStr: RebuildObjStr,
	memo: WeakMap<object, any>
) {
	const out = cloneSchemaNode(original)

	out.anyOf = (original.anyOf as any[]).map((branch, i) =>
		site.u[i]
			? buildCoerceNode(branch, site.u[i]!, seen, objStr, memo)
			: branch
	)
	if (site.em) out.anyOf.push(emptyAsUndefined())

	return out
}

/** @internal */
export const COERCE_LEAF_CACHE_LIMIT = 1024

export function buildCoercedFromPlan(
	original: any,
	plan: CoerceNode,
	seen: Set<string> = new Set(),
	objStr: RebuildObjStr = rebuildObjStrShape,
	memo: WeakMap<object, any> = new WeakMap()
) {
	if (isCoerceLeaf(plan) || isCoerceObjStr(plan) || isCoerceUnion(plan))
		return buildCoerceNode(original, plan, seen, objStr, memo)

	const out = cloneSchemaNode(original)

	if (plan.p) {
		const props: Record<string, unknown> = { ...original.properties }
		for (const k in plan.p)
			props[k] = buildCoerceNode(
				original.properties[k],
				plan.p[k]!,
				seen,
				objStr,
				memo
			)
		out.properties = props
	}

	if (plan.i)
		out.items = buildCoerceNode(original.items, plan.i, seen, objStr, memo)

	return out
}

export { clearCoerceLeafCache } from './shared'
