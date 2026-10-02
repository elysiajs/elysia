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

// since it's private, we can drop unused field to reduce memory usage
export function dropCompiledSource(tb: any) {
	if (tb.evaluateResult) tb.evaluateResult.code = undefined
	if (tb.buildResult) tb.buildResult.functions = undefined
}

export function nonAdditionalProperties(
	node: BaseSchema,
	seen: WeakSet<object> = new WeakSet()
): BaseSchema {
	if (!node || typeof node !== 'object' || seen.has(node)) return node
	seen.add(node)

	let out: any = node

	const set = (key: string, value: unknown) => {
		out = cloneNode(node, out)
		out[key] = value
	}

	const single = (key: string) => {
		const v = (node as any)[key]
		const r = nonAdditionalProperties(v, seen)
		if (r !== v) set(key, r)
	}

	const record = (key: string) => {
		const children = (node as any)[key]
		let copy: Record<string, BaseSchema> | undefined
		for (const k in children) {
			const v = children[k]
			const r = nonAdditionalProperties(v, seen)
			if (r !== v) (copy ??= { ...children })[k] = r
		}
		if (copy) set(key, copy)
	}

	if (node.properties) record('properties')
	if (node.items && !Array.isArray(node.items)) single('items')

	for (const key of ['items', 'anyOf', 'allOf', 'oneOf'] as const) {
		const arr = (node as any)[key]
		if (!Array.isArray(arr)) continue
		let copy: BaseSchema[] | undefined
		for (let i = 0; i < arr.length; i++) {
			const r = nonAdditionalProperties(arr[i], seen)
			if (r !== arr[i]) (copy ??= [...arr])[i] = r
		}
		if (copy) set(key, copy)
	}

	if (
		node.additionalProperties &&
		typeof node.additionalProperties === 'object'
	)
		single('additionalProperties')

	if (node.patternProperties) record('patternProperties')
	if (node.$defs) record('$defs')

	if (
		(node.type === 'object' || (node as any)['~kind'] === 'Object') &&
		!('additionalProperties' in node)
	) {
		out = cloneNode(node, out)
		out.additionalProperties = false
	}

	return out
}
