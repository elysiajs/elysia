import type { Context } from './context'

import type {
	AppHook,
	MaybeArray,
	EventFn,
	EventScope,
	Macro,
	InputSchema,
	InputHook
} from './types'

import { ElysiaFile } from './universal/file'
import { dangerousKeys, type MethodMap, MethodMapBack } from './constants'

export const mapMethodBack = (method: MethodMap[keyof MethodMap] | string) =>
	MethodMapBack[method as MethodMap[keyof MethodMap]] ?? method

export function isEmpty<T extends Object>(obj: T): boolean {
	for (const _ in obj) return false

	return true
}

export function isNotEmpty(obj?: Object): boolean {
	if (!obj) return false

	for (const _ in obj) return true

	return false
}

const FNV_OFFSET_BASIS = 2166136261
const FNV_PRIME = 16777619

export function fnv1a(str: string): number {
	let hash = FNV_OFFSET_BASIS
	const len = str.length

	for (let i = 0; i < len; i++) {
		hash ^= str.charCodeAt(i)
		hash = Math.imul(hash, FNV_PRIME)
	}

	return hash >>> 0
}

/**
 * Maps each lifecycle/derive function to the hash of the named plugin it was
 * first registered on. Used by `.use()` to dedup absorbed hooks: if a fn's
 * origin is already in `parent.#apps`, the parent has already absorbed that
 * named plugin via another path and should skip re-adding the fn.
 *
 * Anonymous plugins (no name) don't tag their fns - there's no hash to dedup
 * by, so their fns always propagate.
 */
export const fnOrigin = new WeakMap<Function, number>()

/**
 * Scope tag set on each registered hook fn at first registration. Used by
 * `filterByScope` (below) to distinguish, at .use() / compile time, between:
 *   - locals (don't propagate to absorbed sub-plugin routes)
 *   - plugin/global (propagate downward - the "scoped/global" set)
 *
 * Like `fnOrigin`, first registration wins - propagated fns added to other
 * instances' `~ext.hooks` via `#pushHook` keep their original tag.
 */
export const fnScope = new WeakMap<Function, EventScope>()

/**
 * Walk a hook layer and keep only entries whose fn passes the predicate
 * (applied to its `fnScope` tag, or `undefined` if never registered).
 *
 * Returns a fresh `Partial<AppHook>` (not a layer reference), or `undefined`
 * if nothing was kept. Arrays are sliced - caller can mutate the result.
 */
export function filterByScope(
	layer: Partial<AppHook> | undefined,
	keep: (s: EventScope | undefined) => boolean
): Partial<AppHook> | undefined {
	if (!layer) return undefined
	let out: Partial<AppHook> | undefined

	for (const key of Object.keys(layer)) {
		if (!eventProperties.has(key)) continue

		const v: MaybeArray<Function> = layer[
			key as keyof typeof layer
		] as MaybeArray<Function>

		if (Array.isArray(v)) {
			const kept = v.filter((fn) => keep(fnScope.get(fn)))

			if (kept.length) ((out ??= nullObject()) as any)[key] = kept
		} else if (keep(fnScope.get(v)))
			((out ??= nullObject()) as any)[key] = v
	}

	return out
}

export const isDownwardScope = (s: EventScope | undefined) =>
	s === 'plugin' || s === 'global'

export const isLocalScope = (s: EventScope | undefined) =>
	s === 'local' || s === undefined

/**
 * Linked-list representation of the inherited downward hook chain for a
 * route. Each `.use()` that propagates extends the parent instance's chain
 * by one node; routes absorbed in that `.use()` snapshot the head pointer
 * - O(1) per stamp, O(N) memory per instance regardless of route count.
 *
 * Single class — V8/JSC sees one hidden class for every node. Two flavours
 * are encoded in the same shape:
 *   - "standard" node: `added` + `parent` set, `combine`/`over` undefined.
 *   - "combine" node: `combine` + `over` set, `added`/`parent` undefined.
 *
 * Combine nodes appear at multi-level absorption (parent.use(child) when
 * child's routes already had their own chain): they link two sibling chains
 * without flattening — `over` is walked first (older / outer context),
 * then `combine` (newer / inner context).
 *
 * Use with {@link flattenChain} to walk tail-first and reconstruct a flat
 * `Partial<AppHook>` at compile time.
 */
// Two distinct shapes — V8/JSC will keep separate hidden classes per
// variant, but each variant is monomorphic at its own creation sites
// (one in `#on`/`#pushHook`, the other in `#use` stamping). Empirically
// faster than a unified 4-field shape: smaller payload + fewer per-node
// undefined slots dominates the polymorphic-IC cost at the walker.
export type ChainNode =
	| { added: Partial<AppHook>; parent: ChainNode | undefined }
	| { combine: ChainNode; over: ChainNode | undefined }

/**
 * Walk the chain tail-first into a fresh `Partial<AppHook>`. Iterative
 * (Task-based) walker with explicit stack — works uniformly for linear
 * chains and combine nodes without recursion.
 */
type Task =
	// visit
	| { kind: 0; node: ChainNode }
	// append
	| { kind: 1; added: Partial<AppHook> }

export function flattenChain(
	start: ChainNode | undefined,
	keep?: (s: EventScope | undefined) => boolean
): Partial<AppHook> | undefined {
	if (!start) return undefined
	const result = nullObject() as Partial<AppHook>

	const stack: Task[] = [{ kind: 0, node: start }]

	while (stack.length) {
		const task = stack.pop()!
		if (task.kind === 1) {
			appendInto(result, task.added, keep)
			continue
		}

		const node = task.node
		if ('combine' in node) {
			// Tail-first: visit `over` (older), then `combine` (newer).
			stack.push({ kind: 0, node: node.combine })
			if (node.over) stack.push({ kind: 0, node: node.over })
		} else {
			stack.push({ kind: 1, added: node.added })
			if (node.parent) stack.push({ kind: 0, node: node.parent })
		}
	}

	if (isNotEmpty(result)) return result
}

function appendInto(
	target: Partial<AppHook>,
	src: Partial<AppHook>,
	keep?: (s: EventScope | undefined) => boolean
): void {
	for (const key of eventProperties) {
		const v = (src as any)[key]
		if (!v) continue
		const raw = Array.isArray(v) ? v : [v]

		const arr = keep ? raw.filter((fn) => keep(fnScope.get(fn))) : raw

		if (!arr.length) continue
		const existing = (target as any)[key]

		// Always materialise arrays - `compileHandler` and friends index by
		// `.length` and `[i]`, which would silently wrong-result on single fns.
		if (existing) (existing as any[]).push(...arr)
		else (target as any)[key] = arr.slice()
	}
}

/**
 *
 * @param url URL to redirect to
 * @param HTTP status code to send,
 */
export const redirect = (
	url: string,
	status: 301 | 302 | 303 | 307 | 308 = 302
) => Response.redirect(url, status)

export type redirect = typeof redirect

export const getLoosePath = (path: string) =>
	path.charCodeAt(path.length - 1) === 47 ? path.slice(0, -1) : path + '/'

export const constantTimeEqual =
	typeof crypto?.timingSafeEqual === 'function'
		? (a: string, b: string) => {
				// Compare as UTF-8 bytes; timingSafeEqual requires equal length
				const ab = Buffer.from(a, 'utf8')
				const bb = Buffer.from(b, 'utf8')

				if (ab.length !== bb.length) return false
				return crypto.timingSafeEqual(ab, bb)
			}
		: (a: string, b: string) => a === b

const isRecordNumber = (
	x: Record<keyof object, unknown> | undefined
): x is Record<number, unknown> =>
	typeof x === 'object' && Object.keys(x).every((x) => !isNaN(+x))

export function mergeResponse(
	a: InputSchema['response'],
	b: InputSchema['response']
) {
	if (isRecordNumber(a) && isRecordNumber(b))
		// Prevent side effect
		return Object.assign({}, a, b)
	else if (a && !isRecordNumber(a) && isRecordNumber(b))
		return Object.assign({ 200: a }, b)

	return b ?? a
}

/**
 * a is mutable, b is immutable
 *
 * If both are arrays, mutates a by pushing/appending b
 */
export function mergeArray<
	A extends MaybeArray<unknown> | undefined,
	B extends MaybeArray<unknown> | undefined
>(
	a: A,
	b: B,
	reverse = false
): (A extends unknown[] ? A : []) | (B extends unknown[] ? B : []) {
	if (!a) return b as any
	if (!b) return a as any

	const aIsArray = Array.isArray(a)
	const bIsArray = Array.isArray(b)

	if (reverse) {
		if (aIsArray && bIsArray) {
			if (b.length === 1) {
				a.unshift(b[0])
				return a as any
			}

			return (b as unknown[]).concat(a) as any
		}

		if (aIsArray) {
			;(a as unknown[]).unshift(b)
			return a as any
		}

		if (bIsArray) return [...b, a] as any

		return [b, a] as any
	}

	if (aIsArray && bIsArray) {
		a.push(...b)
		return a as any
	}

	if (aIsArray) {
		;(a as unknown[]).push(b)
		return a as any
	}

	if (bIsArray) return [a, ...b] as any

	return [a, b] as any
}

/**
 * Like {@link mergeArray} but drops entries from `a` that already appear in
 * `b` by reference. Always allocates fresh arrays - never mutates inputs.
 *
 * Used at the compile-time merge of a route's snapshotted `appHook` with the
 * root's current `rootHook`: the same fn can sit on both sides because
 * `.use()` propagates global/plugin-scoped hooks into the parent, while the
 * route's `appHook` was captured on the child and still holds the original.
 * The fn must run once, in `b`'s position.
 */
export function dedupedMergeArray<
	A extends MaybeArray<unknown> | undefined,
	B extends MaybeArray<unknown> | undefined
>(
	a: A,
	b: B,
	reverse = false
): (A extends unknown[] ? A : []) | (B extends unknown[] ? B : []) {
	if (!a) return (Array.isArray(b) ? (b as unknown[]).slice() : b) as any
	if (!b) return (Array.isArray(a) ? (a as unknown[]).slice() : a) as any

	const aArr = (Array.isArray(a) ? a : [a]) as unknown[]
	const bArr = (Array.isArray(b) ? b : [b]) as unknown[]

	const seen = new Set(bArr)
	const filtered: unknown[] = []
	for (let i = 0; i < aArr.length; i++)
		if (!seen.has(aArr[i])) filtered.push(aArr[i])

	return (reverse ? bArr.concat(filtered) : filtered.concat(bArr)) as any
}

export const schemaProperties = new Set([
	'body',
	'headers',
	'params',
	'query',
	'cookie',
	'response'
])

export const eventProperties = new Set([
	'start',
	'stop',
	'trace',
	'request',
	'parse',
	'transform',
	'beforeHandle',
	'afterHandle',
	'mapResponse',
	'afterResponse',
	'error'
])

const nativeProperties = new Set([
	...schemaProperties,
	...eventProperties,
	'schema',
	'detail'
])

export function hookToGuard(
	a: Partial<AppHook & Macro>
): Partial<AppHook & Macro> {
	if (a.body || a.headers || a.params || a.query || a.cookie) {
		a.schema ??= []
		const schema = Object.create(null)

		if (a.body) {
			schema.body = a.body
			delete a.body
		}

		if (a.headers) {
			schema.headers = a.headers
			delete a.headers
		}

		if (a.params) {
			schema.params = a.params
			delete a.params
		}

		if (a.query) {
			schema.query = a.query
			delete a.query
		}

		if (a.cookie) {
			schema.cookie = a.cookie
			delete a.cookie
		}

		if (a.response) {
			schema.response = a.response
			delete a.response
		}

		a.schema.push(schema)
	}

	return a
}

export function mergeGuard(
	a: Partial<AppHook & Macro>,
	b: Partial<AppHook & Macro> | undefined
): Partial<AppHook & Macro> {
	if (!b) return a
	// b is undefined but it's shorter this way
	if (!a) return b

	a = mergeHook(a, b, true) as any

	// let macro: Record<string, unknown> | undefined
	for (const key in b)
		if (!nativeProperties.has(key as any) && key in b)
			a[key] = b[key as keyof typeof b]

	return a
}

export function mergeHook(
	a: Partial<AppHook>,
	b: Partial<AppHook> | undefined,
	reverse = false,
	dedup = false
): Partial<AppHook> {
	if (!b) return a
	// b is undefined but it's shorter this way
	if (!a) return b

	const merge = (dedup ? dedupedMergeArray : mergeArray) as typeof mergeArray

	if (!a.body && b.body) a.body = b.body
	if (!a.headers && b.headers) a.headers = b.headers
	if (!a.params && b.params) a.params = b.params
	if (!a.query && b.query) a.query = b.query
	if (!a.cookie && b.cookie) a.cookie = b.cookie
	if (a.response || b.response)
		a.response = mergeResponse(a.response, b.response)

	if (a.parse || b.parse) a.parse = merge(a.parse, b.parse, reverse)

	if (a.transform || b.transform)
		a.transform = merge(a.transform, b.transform, reverse)

	if (a.derive || b.derive)
		a.beforeHandle = merge(
			a.beforeHandle,
			merge(a.derive, b.derive),
			reverse
		)

	// Remove in 2.1
	if (a.resolve || b.resolve)
		a.beforeHandle = merge(
			a.beforeHandle,
			merge(a.resolve, b.resolve, reverse),
			reverse
		)

	if (a.beforeHandle || b.beforeHandle)
		a.beforeHandle = merge(a.beforeHandle, b.beforeHandle, reverse)

	if (a.afterHandle || b.afterHandle)
		a.afterHandle = merge(a.afterHandle, b.afterHandle, reverse)

	if (a.mapResponse || b.mapResponse)
		a.mapResponse = merge(a.mapResponse, b.mapResponse, reverse)

	if (a.afterResponse || b.afterResponse)
		a.afterResponse = merge(a.afterResponse, b.afterResponse, reverse)

	if (a.error || b.error) a.error = merge(a.error, b.error, reverse)
	if (a.schema || b.schema)
		a.schema = mergeArray(a.schema, b.schema, reverse) as any

	return a
}

export function createErrorEventHandler(fn: EventFn<'error'>, error: Error) {
	return (context: Context) => {
		if (
			// @ts-expect-error
			context.error instanceof
			// @ts-expect-error
			(error as unknown as Error)
		)
			return fn!(context)
	}
}

const isObject = (item: any): item is Object =>
	item && typeof item === 'object' && !Array.isArray(item)

const isClassRegex = /^\s*class\s+/
export const isClass = (v: Object) =>
	(typeof v === 'function' && isClassRegex.test(v.toString())) ||
	// Handle Object.create(null)
	(v.toString &&
		// Handle import * as Sentry from '@sentry/bun'
		// This also handle [object Date], [object Array]
		// and FFI value like [object Prisma]
		v.toString().startsWith('[object ') &&
		v.toString() !== '[object Object]') ||
	// If object prototype is not pure, then probably a class-like object
	isNotEmpty(Object.getPrototypeOf(v))

export function mergeDeep<
	A extends Record<string, any>,
	B extends Record<string, any>
>(
	target: A,
	source: B,
	options?: {
		skipKeys?: string[]
		override?: boolean
		mergeArray?: boolean
		seen?: WeakSet<object>
	}
): A & B {
	const skipKeys = options?.skipKeys
	const override = options?.override ?? true
	const mergeArray = options?.mergeArray ?? false
	const seen = options?.seen ?? new WeakSet<object>()

	if (!isObject(target) || !isObject(source)) return target as A & B

	if (seen.has(source)) return target as A & B
	seen.add(source)

	for (const [key, value] of Object.entries(source)) {
		if (skipKeys?.includes(key) || dangerousKeys.has(key as any)) continue

		if (mergeArray && Array.isArray(value)) {
			target[key as keyof typeof target] = Array.isArray(
				(target as any)[key]
			)
				? [...(target as any)[key], ...value]
				: (target[key as keyof typeof target] = value as any)

			continue
		}

		if (!isObject(value) || !(key in target) || isClass(value)) {
			if ((override || !(key in target)) && !Object.isFrozen(target))
				target[key as keyof typeof target] = value

			continue
		}

		if (!Object.isFrozen(target[key]))
			target[key as keyof typeof target] = mergeDeep(
				(target as any)[key] as any,
				value,
				{ skipKeys, override, mergeArray, seen }
			)
	}

	seen.delete(source)

	return target as A & B
}

export const isBlob = (value: unknown): value is Blob =>
	value instanceof Blob || value instanceof ElysiaFile

export const nullObject = () => Object.create(null)

export function cloneHook<T extends Partial<InputHook> | Partial<AppHook>>(
	src: T
): T {
	const out = Object.assign(nullObject(), src) as Record<string, any>

	for (const key of eventProperties)
		if (Array.isArray(out[key])) out[key] = (out[key] as unknown[]).slice()

	return out as T
}

export function joinPath(base: string, path: string) {
	const baseEndsWithSlash = base.charCodeAt(base.length - 1) === 47
	const pathStartsWithSlash = path.charCodeAt(0) === 47

	if (baseEndsWithSlash && pathStartsWithSlash) return base + path.slice(1)
	if (!baseEndsWithSlash && !pathStartsWithSlash) return base + '/' + path

	return base + path
}

export function pushField<K extends keyof any>(
	target: Record<K, unknown>,
	key: K,
	item: unknown,
	defaultArray = false
) {
	const v = target[key]
	if (v) {
		if (Array.isArray(v)) (target[key] as unknown[]).push(item)
		else target[key] = [v, item]
	} else target[key] = defaultArray ? [item] : item
}

export const pushArray = <K extends keyof any>(
	target: Record<K, unknown>,
	key: K,
	item: unknown
) => pushField(target, key, item, true)
