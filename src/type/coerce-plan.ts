import { Decode, Refine } from 'typebox/type'

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

function ObjectStringShape(property: any, _options?: any) {
	const [{ properties, ...constraints }, meta] = getMeta(
		(_options ?? nullObject()) as any
	)
	const object = ObjectType(property, constraints)

	const objectString = Decode(
		Refine(StringType(), icPlaceholder, () => 'must be an object'),
		icPlaceholder
	)

	return elyType(
		ELYSIA_TYPES.ObjectString,
		Union([object, objectString], meta)
	)
}

function ArrayStringShape(property: any, _options?: any) {
	const [constraints, meta] = getMeta((_options ?? nullObject()) as any)
	const array = ArrayType(property, constraints)

	const arrayString = Decode(
		Refine(StringType(), icPlaceholder, () => 'must be an array'),
		icPlaceholder
	)

	return elyType(ELYSIA_TYPES.ArrayString, Union([array, arrayString], meta))
}

// Shape twin of `coerce.ts` `rebuildObjStr`
// fresh nodes per rebuild, never cached: `reconstructInnerCodecs` mutates them in place
const rebuildObjStrShape: RebuildObjStr = (original, site) => {
	const { type, ...rest } = original
	const node =
		site.os === ELYSIA_TYPES.ObjectString
			? ObjectStringShape(rest.properties ?? nullObject(), rest)
			: ArrayStringShape(rest.items ?? nullObject(), rest)

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
): any =>
	isCoerceLeaf(node)
		? coerceLeaf(node, seen)
		: isCoerceObjStr(node)
			? objStr(original, node)
			: isCoerceUnion(node)
				? rebuildUnion(original, node, seen, objStr)
				: buildCoercedFromPlan(original, node, seen, objStr)

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

function coerceLeaf(leaf: CoerceLeaf, seen: Set<string>) {
	const key = leaf.e + (leaf.c ? JSON.stringify(leaf.c) : '')

	let node: any
	if (seen.has(key)) {
		// @ts-expect-error
		node = COERCE_LEAF_CTOR[leaf.e]!(leaf.c)
	} else {
		seen.add(key)
		node = coerceLeafCache.get(key)
		if (node === undefined) {
			// @ts-expect-error
			node = COERCE_LEAF_CTOR[leaf.e]!(leaf.c)

			if (coerceLeafCache.size >= COERCE_LEAF_CACHE_LIMIT)
				evictOldestHalf(coerceLeafCache)

			coerceLeafCache.set(key, node)
		} else if (coerceLeafCache.size >= COERCE_LEAF_CACHE_LIMIT) {
			coerceLeafCache.delete(key)
			coerceLeafCache.set(key, node)
		}
	}

	// per-use `~optional` wrapper (don't mutate the shared frozen leaf)
	if ('o' in leaf)
		return Object.defineProperty(Object.create(node), '~optional', {
			value: leaf.o,
			enumerable: false
		})

	return node
}

export function buildCoercedFromPlan(
	original: any,
	plan: CoercePlan,
	seen: Set<string> = new Set(),
	objStr: RebuildObjStr = rebuildObjStrShape
) {
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

export { clearCoerceLeafCache, coerceLeafCacheSize } from './shared'
