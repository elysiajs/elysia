import { Decode, Refine } from './typebox-type'

import { ELYSIA_TYPES } from './constants'
import { nullObject, evictOldestHalf } from '../utils'
import { coerceLeafCache } from './shared'

import { Numeric } from './elysia/numeric'
import { BooleanString } from './elysia/boolean-string'
import { IntegerString } from './elysia/integer-string'
import { ObjectType } from './elysia/object'
import { ArrayType } from './elysia/array'
import { StringType } from './elysia/string'
import { Union } from './elysia/union'
import { elyType, getMeta } from './elysia/utils'

export const COERCE_LEAF_CTOR = {
	[ELYSIA_TYPES.Numeric]: Numeric,
	[ELYSIA_TYPES.Integer]: IntegerString,
	[ELYSIA_TYPES.BooleanString]: BooleanString
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

	const node = elyType(
		isObject ? ELYSIA_TYPES.ObjectString : ELYSIA_TYPES.ArrayString,
		Union(
			[
				inner,
				Decode(
					Refine(StringType(), icPlaceholder, () =>
						isObject ? 'must be an object' : 'must be an array'
					),
					icPlaceholder
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

const buildCoerceNode = (
	original: any,
	node: CoerceNode,
	seen: Set<string>,
	objStr: RebuildObjStr
): any => {
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

		// per-use `~optional` wrapper (don't mutate the shared frozen leaf)
		if ('o' in node)
			return Object.defineProperty(Object.create(leaf), '~optional', {
				value: node.o,
				enumerable: false
			})

		return leaf
	}

	if (isCoerceObjStr(node)) return objStr(original, node)
	if (isCoerceUnion(node)) return rebuildUnion(original, node, seen, objStr)

	return buildCoercedFromPlan(original, node, seen, objStr)
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
	objStr: RebuildObjStr
) {
	const out = cloneSchemaNode(original)

	out.anyOf = (original.anyOf as any[]).map((branch, i) =>
		site.u[i] ? buildCoerceNode(branch, site.u[i]!, seen, objStr) : branch
	)

	return out
}

/** @internal */
export const COERCE_LEAF_CACHE_LIMIT = 1024

export function buildCoercedFromPlan(
	original: any,
	plan: CoerceNode,
	seen: Set<string> = new Set(),
	objStr: RebuildObjStr = rebuildObjStrShape
) {
	if (isCoerceLeaf(plan) || isCoerceObjStr(plan) || isCoerceUnion(plan))
		return buildCoerceNode(original, plan, seen, objStr)

	const out = cloneSchemaNode(original)

	if (plan.p) {
		const props: Record<string, unknown> = { ...original.properties }
		for (const k in plan.p)
			props[k] = buildCoerceNode(
				original.properties[k],
				plan.p[k]!,
				seen,
				objStr
			)
		out.properties = props
	}

	if (plan.i)
		out.items = buildCoerceNode(original.items, plan.i, seen, objStr)

	return out
}

export { clearCoerceLeafCache } from './shared'
