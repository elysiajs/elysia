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
// Not a cache, provenance, never cleared
const pureRefinements = new WeakSet<object>()

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

export function copyNonEnumerable(
	src: object,
	target: object,
	skipKey?: string
) {
	for (const key of Object.getOwnPropertyNames(src)) {
		const desc = Object.getOwnPropertyDescriptor(src, key)
		if (!desc || desc.enumerable || key === skipKey) continue

		Object.defineProperty(target, key, {
			value: desc.value,
			enumerable: false,
			writable: true,
			configurable: true
		})
	}
}

export function cloneNode(node: BaseSchema, out: any) {
	if (out !== node) return out

	const target: any = { ...node, '~kind': (node as any)['~kind'] }
	copyNonEnumerable(node, target, '~kind')

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
