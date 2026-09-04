// typebox-free leaf: shared caches + schema-node clone helpers used by both
// `coerce.ts` and `coerce-plan.ts` (and the elysia string/utils caches).
// Imports NOTHING from coerce, coerce-plan, validator, or type/elysia
// keep it a leaf so `validator/index.ts` doesn't drag `typebox/type` in eagerly
import { noEnumerable } from './constants'
import type { BaseSchema } from '.'

/** @internal */
export const SHARED_REFERENCE_CACHE_LIMIT = 1024

const sharedReferenceCaches = new Set<Map<number, any> | Map<string, any>>()

/** @internal */
export function referenceCache(cache: Map<number, any> | Map<string, any>) {
	sharedReferenceCaches.add(cache)
}

/** @internal */
export function clearSharedReferenceCaches() {
	for (const cache of sharedReferenceCaches) cache.clear()
}

// Elysia-owned refinement predicates
// They are pure and stateless, this let `collectRefinements` skip the single-evaluation recording pool
// the failure-path `Errors()` walk can simply call the predicate again
//
// Not a cache, provenance, never cleared
const pureRefinements = new WeakSet<object>()

/**
 * @internal Tag every `~refine` entry of a framework-built node as pure.
 * Only ever call this on nodes whose predicates are self-contained: a predicate
 * that can transitively reach a USER refinement (e.g. ObjectString, which runs
 * `Check` over the inner schema) is NOT pure and must keep the pool.
 */
export function pureRefine<T>(node: T): T {
	const refinements = (node as any)?.['~refine']

	if (Array.isArray(refinements))
		for (const refinement of refinements)
			if (refinement && typeof refinement === 'object')
				pureRefinements.add(refinement)

	return node
}

/** @internal */
export const isPureRefinement = (refinement: object) =>
	pureRefinements.has(refinement)

/** @internal */
export const coerceLeafCache = new Map<string, any>()

/** @internal test isolation */
export function clearCoerceLeafCache() {
	// eslint-disable-next-line sonarjs/no-empty-collection -- intentional cache reset
	coerceLeafCache.clear()
}

// clone `node` preserving prototype + non-enumerable markers (`~kind`, ...)
// only when `out` hasn't already been cloned (`out !== node`)
export function cloneNode(node: BaseSchema, out: any) {
	if (out !== node) return out

	const target: any = { ...node, '~kind': (node as any)['~kind'] }
	for (const key of Object.getOwnPropertyNames(node)) {
		const desc = Object.getOwnPropertyDescriptor(node, key)
		if (!desc || desc.enumerable || key === '~kind') continue

		Object.defineProperty(target, key, {
			value: desc.value,
			enumerable: false,
			writable: true,
			configurable: true
		})
	}

	return Object.defineProperty(target, '~kind', noEnumerable)
}

export function nonAdditionalProperties(
	node: BaseSchema,
	seen: WeakSet<object> = new WeakSet()
): BaseSchema {
	if (!node || typeof node !== 'object' || seen.has(node)) return node
	seen.add(node)

	let out: any = node

	if (node.properties) {
		let newProps: Record<string, BaseSchema> | undefined
		for (const k in node.properties) {
			const v = node.properties[k] as BaseSchema
			const r = nonAdditionalProperties(v, seen)
			if (r !== v) {
				newProps ??= { ...node.properties }
				newProps[k] = r
			}
		}
		if (newProps) {
			out = cloneNode(node, out)
			out.properties = newProps
		}
	}

	if (node.items) {
		if (Array.isArray(node.items)) {
			let newItems: BaseSchema[] | undefined
			for (let i = 0; i < node.items.length; i++) {
				const r = nonAdditionalProperties(
					node.items[i] as BaseSchema,
					seen
				)
				if (r !== node.items[i]) {
					newItems ??= [...(node.items as BaseSchema[])]
					newItems[i] = r
				}
			}
			if (newItems) {
				out = cloneNode(node, out)
				out.items = newItems
			}
		} else {
			const r = nonAdditionalProperties(
				node.items as BaseSchema,
				seen
			)
			if (r !== node.items) {
				out = cloneNode(node, out)
				out.items = r
			}
		}
	}

	for (const key of ['anyOf', 'allOf', 'oneOf'] as const) {
		const arr = (node as any)[key]
		if (!Array.isArray(arr)) continue
		let newArr: BaseSchema[] | undefined
		for (let i = 0; i < arr.length; i++) {
			const r = nonAdditionalProperties(arr[i], seen)
			if (r !== arr[i]) {
				newArr ??= [...arr]
				newArr[i] = r
			}
		}
		if (newArr) {
			out = cloneNode(node, out)
			out[key] = newArr
		}
	}

	if (
		node.additionalProperties &&
		typeof node.additionalProperties === 'object'
	) {
		const r = nonAdditionalProperties(
			node.additionalProperties as BaseSchema,
			seen
		)
		if (r !== node.additionalProperties) {
			out = cloneNode(node, out)
			out.additionalProperties = r
		}
	}

	if (node.patternProperties) {
		let newPP: Record<string, BaseSchema> | undefined
		for (const k in node.patternProperties) {
			const v = node.patternProperties[k] as BaseSchema
			const r = nonAdditionalProperties(v, seen)
			if (r !== v) {
				newPP ??= { ...node.patternProperties }
				newPP[k] = r
			}
		}
		if (newPP) {
			out = cloneNode(node, out)
			out.patternProperties = newPP
		}
	}

	if (node.$defs) {
		let newDefs: Record<string, BaseSchema> | undefined
		for (const k in node.$defs) {
			const v = node.$defs[k] as BaseSchema
			const r = nonAdditionalProperties(v, seen)
			if (r !== v) {
				newDefs ??= { ...node.$defs }
				newDefs[k] = r
			}
		}

		if (newDefs) {
			out = cloneNode(node, out)
			out.$defs = newDefs
		}
	}

	if (
		(node.type === 'object' || (node as any)['~kind'] === 'Object') &&
		!('additionalProperties' in node)
	) {
		out = cloneNode(node, out)
		out.additionalProperties = false
	}

	return out
}
