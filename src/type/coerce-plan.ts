import { ELYSIA_TYPES } from './constants'

import { Numeric } from './elysia/numeric'
import { BooleanString } from './elysia/boolean-string'
import { IntegerString } from './elysia/integer-string'

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

export type CoerceNode = CoerceLeaf | CoerceObjStr | CoercePlan

export interface CoercePlan {
	// per-property coercion (key → leaf / objstr / nested plan)
	p?: Record<string, CoerceNode>
	// single-schema array items coercion
	i?: CoerceNode
}

export const isCoerceLeaf = (x: CoerceNode): x is CoerceLeaf =>
	typeof (x as CoerceLeaf).e === 'number'

export const isCoerceObjStr = (x: CoerceNode): x is CoerceObjStr =>
	typeof (x as CoerceObjStr).os === 'number'

const nodeIsScalarOnly = (node: CoerceNode) =>
	isCoerceLeaf(node)
		? true
		: isCoerceObjStr(node)
			? false
			: planIsScalarOnly(node)

export function planIsScalarOnly(plan: CoercePlan): boolean {
	if (plan.p)
		for (const k in plan.p) if (!nodeIsScalarOnly(plan.p[k]!)) return false

	return !(plan.i && !nodeIsScalarOnly(plan.i))
}

/** Rebuilds an ObjectString/ArrayString coercion site (see `coerce.ts`). */
export type RebuildObjStr = (original: any, site: CoerceObjStr) => any

const objStrRefused: RebuildObjStr = () => {
	throw new Error(
		'[elysia] CoercePlan contains an ObjectString/ArrayString site but no' +
			' rebuilder was provided (bridge-free path only rebuilds scalar plans)'
	)
}

const buildCoerceNode = (
	original: any,
	node: CoerceNode,
	seen: Set<string>,
	objStr: RebuildObjStr
) =>
	isCoerceLeaf(node)
		? coerceLeaf(node, seen)
		: isCoerceObjStr(node)
			? objStr(original, node)
			: buildCoercedFromPlan(original, node, seen, objStr)

const coerceLeafCache = new Map<string, any>()

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
	objStr: RebuildObjStr = objStrRefused
) {
	const out = Object.create(Object.getPrototypeOf(original))

	for (const k in original) out[k] = original[k]

	for (const s of Object.getOwnPropertyNames(original)) {
		const d = Object.getOwnPropertyDescriptor(original, s)!
		if (!d.enumerable) Object.defineProperty(out, s, d)
	}

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

/** @internal test isolation */
export function clearCoerceLeafCache() {
	coerceLeafCache.clear()
}
