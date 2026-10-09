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
export const replaceFunction = <T extends Function>(
	replacement: T,
	original: Function
): T & { '~original': T } =>
	Object.defineProperty(replacement, '~original', {
		value: (original as any)['~original'] ?? original
	}) as any

/** @internal */
export const originalFunction = <T extends Function>(
	fn: T & { '~original': NoInfer<T> }
): T => (fn as any)['~original'] ?? fn

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
	// a node reused at many positions closes at each, a cycle stays open
	seen: WeakMap<object, BaseSchema> = new WeakMap(),
	// an allOf member: its top level keys answer to the allOf's
	// `unevaluatedProperties`, closing it would reject the other members' keys
	open = false,
	seenOpen: WeakMap<object, BaseSchema> = new WeakMap(),
	defs?: Record<string, BaseSchema>
): BaseSchema {
	if (!node || typeof node !== 'object') return node

	defs = node.$defs ?? defs
	// an open `$ref` into `$defs` is inlined open, the def stays closed elsewhere
	const def = open && node.$ref && defs?.[node.$ref]
	if (def) {
		const r = cloneNode(
			def,
			nonAdditionalProperties(def, seen, true, seenOpen, defs)
		)
		delete (r as any).$id
		return r
	}

	const memo = open ? seenOpen : seen
	const closed = memo.get(node)
	if (closed) return closed
	memo.set(node, node)

	let out: any = node

	const set = (key: string, value: unknown) => {
		out = cloneNode(node, out)
		out[key] = value
	}

	const single = (key: string, top?: boolean) => {
		const v = (node as any)[key]
		const r = nonAdditionalProperties(v, seen, top, seenOpen, defs)
		if (r !== v) set(key, r)
	}

	const record = (key: string) => {
		const children = (node as any)[key]
		let copy: Record<string, BaseSchema> | undefined
		for (const k in children) {
			const v = children[k]
			const r = nonAdditionalProperties(v, seen, false, seenOpen, defs)
			if (r !== v) (copy ??= { ...children })[k] = r
		}
		if (copy) set(key, copy)
	}

	if (node.properties) record('properties')
	if (node.items && !Array.isArray(node.items)) single('items')

	for (const key of ['items', 'anyOf', 'allOf', 'oneOf'] as const) {
		const arr = (node as any)[key]
		if (!Array.isArray(arr)) continue
		// branches at an open node's top level are open too
		const branch = key === 'allOf' || (open && key !== 'items')
		let copy: BaseSchema[] | undefined
		for (let i = 0; i < arr.length; i++) {
			const r = nonAdditionalProperties(
				arr[i],
				seen,
				branch,
				seenOpen,
				defs
			)
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

	// a Dependent's branches are like allOf members
	for (const key of ['then', 'else']) single(key, true)

	if (!open && !('additionalProperties' in node)) {
		const members = 'if' in node ? [out.then, out.else] : out.allOf
		if (Array.isArray(members)) {
			// TypeBox applies it to arrays too, an array intersect stays as is
			if (
				!('unevaluatedProperties' in node) &&
				!members.some((member: any) => member?.type === 'array')
			) {
				out = cloneNode(node, out)
				out.unevaluatedProperties = false
			}
		} else if (
			node.type === 'object' ||
			(node as any)['~kind'] === 'Object'
		) {
			out = cloneNode(node, out)
			out.additionalProperties = false
		}
	}

	memo.set(node, out)
	return out
}
