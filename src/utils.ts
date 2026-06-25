import { dangerousKeys, type MethodMap, MethodMapBack } from './constants'
import { ElysiaFile } from './universal/file'
import { isBun } from './universal/constants'

import type { Context } from './context'
import type {
	AppHook,
	MaybeArray,
	EventFn,
	EventScope,
	Macro,
	InputSchema,
	AnyLocalHook,
	GuardSchemaType,
	ElysiaFormData
} from './types'

export const nullObject = () => Object.create(null)

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

export const isDownwardScope = (s: EventScope | undefined) =>
	s === 'plugin' || s === 'global'

export const isLocalScope = (s: EventScope | undefined) =>
	s === 'local' || s === undefined

/**
 * Linked-list representation of the scope/global hook chain of a route
 *
 * Each `.use()` that propagates extends the parent instance's chain
 * by one node; routes absorbed in that `.use()` snapshot the head pointer
 *
 * - O(1) per stamp, O(N) memory per instance regardless of route count
 *
 * shapes:
 * 1. "standard" node: `added` + `parent` set, `combine`/`over` undefined
 * 2. "combine" node: `combine` + `over` set, `added`/`parent` undefined
 *
 * Combine nodes appear at multi-level absorption (parent.use(child) when
 * child's routes already had their own chain): they link two sibling chains
 * without flattening - `over` is walked first (older / outer context),
 * then `combine` (newer / inner context)
 *
 * Use with {@link flattenChain} to walk tail-first and reconstruct
 * flat `Partial<AppHook>` at compile time
 */
export type ChainNode =
	| {
			added: Partial<AppHook>
			parent: ChainNode | undefined
			// Scope this node was registered at (`#on` / `#guard`).
			// All entries in the node share this scope by construction.
			scope?: EventScope
			// True if this node was created by `#use` propagation rather
			// than direct registration. Used to enforce the "plugin scope
			// propagates exactly one level" rule: `plugin` nodes with
			// `propagated=true` are skipped in subsequent `#use` walks.
			// Globals propagate regardless of this flag.
			propagated?: boolean
	  }
	| { combine: ChainNode; over: ChainNode | undefined }

const flattenNodeStack: ChainNode[] = []
const flattenPhaseStack: number[] = []

/**
 * Walk the chain tail-first into a fresh `Partial<AppHook>`
 *
 * Explicit-stack walk (no recursion) so it works uniformly for linear
 * chains and combine nodes without risking stack overflow on deep chains
 */
export function flattenChain(
	start: ChainNode | undefined,
	keep?: (s: EventScope | undefined) => boolean,
	stopAt?: ChainNode
): Partial<AppHook> | undefined {
	if (!start || start === stopAt) return
	const result = nullObject() as Partial<AppHook>

	const nodes = flattenNodeStack
	const phases = flattenPhaseStack
	nodes.length = 0
	phases.length = 0
	nodes.push(start)
	phases.push(0)

	while (nodes.length) {
		const node = nodes.pop()!
		const phase = phases.pop()!

		if (phase === 1) {
			appendInto(
				result,
				(node as { added: Partial<AppHook> }).added,
				keep,
				(node as { scope?: EventScope }).scope
			)
			continue
		}

		if (stopAt && node === stopAt) continue
		if ('combine' in node) {
			// Tail-first: visit `over` (older), then `combine` (newer).
			nodes.push(node.combine)
			phases.push(0)
			if (node.over) {
				nodes.push(node.over)
				phases.push(0)
			}
		} else {
			// Append self after its parent has been visited/appended.
			nodes.push(node)
			phases.push(1)
			if (node.parent && node.parent !== stopAt) {
				nodes.push(node.parent)
				phases.push(0)
			}
		}
	}

	if (isNotEmpty(result)) return result
}

const flattenChainMemos = new WeakMap<
	object,
	WeakMap<ChainNode, Partial<AppHook>>
>()
const emptyFlatten = Object.freeze(nullObject()) as Partial<AppHook>

export function flattenChainMemo(
	root: object,
	start: ChainNode | undefined
): Partial<AppHook> | undefined {
	if (!start) return

	let perRoot = flattenChainMemos.get(root)
	if (!perRoot) {
		perRoot = new WeakMap()
		flattenChainMemos.set(root, perRoot)
	}

	let cached = perRoot.get(start)
	if (cached === undefined) {
		cached = flattenChain(start) ?? emptyFlatten
		perRoot.set(start, cached)
	}

	if (cached === emptyFlatten) return

	// `cloneHook` is identical to the former local `cloneFlatHook`: a shallow
	// copy with per-key array `.slice()` so the caller can mutate the result
	// without touching the memoised (shared) flatten.
	return cloneHook(cached)
}

function appendInto(
	target: Partial<AppHook>,
	src: Partial<AppHook>,
	keep?: (s: EventScope | undefined) => boolean,
	nodeScope?: EventScope
): void {
	if (keep && !keep(nodeScope)) return

	for (const key in src) {
		const v = (src as any)[key]
		if (v === undefined || v === null) continue

		if (eventProperties.has(key) || key === 'schemas') {
			const existing = (target as any)[key]

			if (Array.isArray(v)) {
				if (existing) {
					const arr = existing as any[]
					for (let i = 0; i < v.length; i++) arr.push(v[i])
				} else (target as any)[key] = v.slice()
			} else if (existing) (existing as any[]).push(v)
			else (target as any)[key] = [v]
		} else (target as any)[key] = v
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

function appendFormField(formData: FormData, key: string, value: unknown) {
	if (value === undefined || value === null) return

	if (value instanceof Blob) formData.append(key, value)
	else if (value instanceof ElysiaFile)
		formData.append(key, value.value as Blob)
	else if (typeof value === 'object')
		formData.append(key, JSON.stringify(value))
	else formData.append(key, '' + value)
}

/**
 * Build `FormData` from a `form()` object, skipping the internal `~ely-form`
 * marker that flags the object as a form.
 */
export function formToFormData(value: Record<keyof any, unknown>): FormData {
	const formData = new FormData()

	for (const key in value) {
		if (key === '~ely-form') continue

		const field = value[key]

		if (Array.isArray(field))
			for (const item of field) appendFormField(formData, key, item)
		else appendFormField(formData, key, field)
	}

	return formData
}

/**
 * Return a `multipart/form-data` response.
 *
 * @example
 * ```ts
 * import { Elysia, form, file } from 'elysia'
 *
 * new Elysia().get('/', () =>
 * 	form({
 * 		name: 'Tea Party',
 * 		images: [file('1.webp'), file('2.webp')]
 * 	})
 * )
 * ```
 */
export const form = <const T extends Record<keyof any, unknown>>(
	value: T
): ElysiaFormData<T> =>
	// A plain object (not a class instance) keeps V8's fast object shape - the
	// fields are own enumerable props so the `t.Form` object validator sees
	// them, and the enumerable `~ely-form` marker flags it as a form for the
	// response mapper and the `t.Form` refine (`'~ely-form' in value`).
	({ ...value, '~ely-form': 1 }) as unknown as ElysiaFormData<T>

export const getLoosePath = (path: string) =>
	path.charCodeAt(path.length - 1) === 47 ? path.slice(0, -1) : path + '/'

import type { SSEPayload, Prettify } from './types'

type FormatSSEPayload<T = unknown> = T extends string
	? { readonly data: T }
	: Prettify<SSEPayload<T>>

export const sse = <
	const T extends
		| string
		| SSEPayload
		| Generator
		| AsyncGenerator
		| ReadableStream
>(
	_payload: T
): T extends string
	? { readonly data: T }
	: T extends SSEPayload
		? T
		: T extends ReadableStream<infer A>
			? ReadableStream<FormatSSEPayload<A>>
			: T extends Generator<infer A, infer B, infer C>
				? Generator<FormatSSEPayload<A>, B, C>
				: T extends AsyncGenerator<infer A, infer B, infer C>
					? AsyncGenerator<FormatSSEPayload<A>, B, C>
					: T => {
	if (_payload instanceof ReadableStream) {
		// @ts-expect-error
		_payload.sse = true
		return _payload as any
	}

	const payload: SSEPayload =
		typeof _payload === 'string'
			? { data: _payload }
			: (_payload as SSEPayload)

	// @ts-ignore
	payload.sse = true

	// @ts-ignore
	payload.toSSE = () => {
		let s = ''
		if (payload.id !== undefined && payload.id !== null)
			s += `id: ${payload.id}\n`
		if (payload.event) s += `event: ${payload.event}\n`
		if (payload.retry !== undefined) s += `retry: ${payload.retry}\n`
		if (payload.data === null) s += 'data: null\n'
		else if (typeof payload.data === 'string')
			s += `data: ${payload.data}\n`
		else if (typeof payload.data === 'object')
			s += `data: ${JSON.stringify(payload.data)}\n`

		if (s) s += '\n'
		return s
	}

	return payload as any
}

export const constantTimeEqual =
	typeof crypto?.timingSafeEqual === 'function'
		? (a: string, b: string) => {
				// Compare as UTF-8 bytes; timingSafeEqual requires equal length
				const ab = Buffer.from(a, 'utf8')
				const bb = Buffer.from(b, 'utf8')

				if (ab.length !== bb.length) return false
				return crypto.timingSafeEqual(ab, bb)
			}
		: (a: string, b: string) => {
				if (a.length !== b.length) return false

				let mismatch = 0
				for (let i = 0; i < a.length; i++)
					mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)

				return mismatch === 0
			}

export const isRecordNumber = (
	x: Record<keyof object, unknown> | undefined
): x is Record<number, unknown> =>
	typeof x === 'object' && Object.keys(x).every((x) => !isNaN(+x))

export function mergeResponse(
	a: InputSchema['response'],
	b: InputSchema['response']
) {
	const aRecord = isRecordNumber(a)
	const bRecord = isRecordNumber(b)

	if (aRecord && bRecord) return Object.assign({}, a, b)
	if (aRecord && b)
		// `a` is `{ 400: ..., 500: ... }`, `b` is a single schema → 200.
		return Object.assign({}, a, { 200: b })
	if (a && bRecord) return Object.assign({ 200: a }, b)

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

		if (bIsArray) {
			const out = new Array(b.length + 1)
			for (let i = 0; i < b.length; i++) out[i] = b[i]
			out[b.length] = a

			return out as any
		}

		return [b, a] as any
	}

	if (aIsArray && bIsArray) {
		for (let i = 0; i < b.length; i++) a.push(b[i])
		return a as any
	}

	if (aIsArray) {
		;(a as unknown[]).push(b)
		return a as any
	}

	if (bIsArray) {
		const out = new Array(b.length + 1)
		out[0] = a
		for (let i = 0; i < b.length; i++) out[i + 1] = b[i]

		return out as any
	}

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

export function hookToGuard(
	a: Partial<AppHook & Macro> & {
		schema?: GuardSchemaType
	}
): Partial<AppHook & Macro> {
	if (a.schema !== 'standalone') return a

	if (a.body || a.headers || a.params || a.query || a.cookie || a.response) {
		a.schemas ??= []
		const schema = Object.create(null)

		if (a.body) {
			schema.body = a.body
			a.body = undefined
		}

		if (a.headers) {
			schema.headers = a.headers
			a.headers = undefined
		}

		if (a.params) {
			schema.params = a.params
			a.params = undefined
		}

		if (a.query) {
			schema.query = a.query
			a.query = undefined
		}

		if (a.cookie) {
			schema.cookie = a.cookie
			a.cookie = undefined
		}

		if (a.response) {
			schema.response = a.response
			a.response = undefined
		}

		a.schemas.push(schema)
	}

	return a
}

export function coalesceStandaloneSchemas(
	existing: any[],
	incoming: any[]
): void {
	for (const entry of incoming) {
		if (!entry || typeof entry !== 'object') continue

		let merged = false
		for (let i = 0; i < existing.length; i++) {
			const e = existing[i]
			let canMerge = true
			for (const k in entry) {
				if (k in e && e[k] !== entry[k]) {
					canMerge = false
					break
				}
			}

			if (canMerge) {
				Object.assign(e, entry)
				merged = true
				break
			}
		}

		if (!merged) existing.push(entry)
	}
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
	if (!a.response && b.response) a.response = b.response
	else if (a.response && b.response)
		a.response = mergeResponse(b.response, a.response) as any

	if (a.parse || b.parse) a.parse = merge(a.parse, b.parse, reverse)

	if (a.transform || b.transform)
		a.transform = merge(a.transform, b.transform, reverse)

	// @ts-expect-error
	if (a.derive || b.derive) a.derive = merge(a.derive, b.derive, reverse)

	if (a.beforeHandle || b.beforeHandle)
		a.beforeHandle = merge(a.beforeHandle, b.beforeHandle, reverse)

	if (a.afterHandle || b.afterHandle)
		a.afterHandle = merge(a.afterHandle, b.afterHandle, reverse)

	if (a.mapResponse || b.mapResponse)
		a.mapResponse = merge(a.mapResponse, b.mapResponse, reverse)

	if (a.afterResponse || b.afterResponse)
		a.afterResponse = merge(a.afterResponse, b.afterResponse, reverse)

	if (a.error || b.error) a.error = merge(a.error, b.error, reverse)

	if (a.trace || b.trace) a.trace = merge(a.trace, b.trace, reverse)

	if (a.schemas || b.schemas)
		a.schemas = mergeArray(a.schemas, b.schemas, reverse) as any

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
			return fn!(context as any)
	}
}

const isObject = (item: any): item is Object =>
	item && typeof item === 'object' && !Array.isArray(item)

const isClassRegex = /^\s*class\s+/
const isClass = (v: Object) =>
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
	skipKeys?: string[],
	override: boolean = true,
	mergeArray: boolean = false,
	seen?: WeakSet<object>
): A & B {
	if (!isObject(target) || !isObject(source)) return target as A & B
	if (seen?.has(source)) return target as A & B

	for (const key in source) {
		if (!Object.hasOwn(source, key)) continue

		const value = source[key]
		if (skipKeys?.includes(key) || dangerousKeys.has(key as any)) continue

		if (mergeArray && Array.isArray(value)) {
			const existing = (target as any)[key]

			// Allocate a fresh array on merge - `existing` may be aliased to a
			// shared source (e.g. an object-macro's `detail.tags`), so pushing
			// into it in place would leak across every reuse of that source.
			target[key as keyof typeof target] = (
				Array.isArray(existing) ? existing.concat(value) : value
			) as any

			continue
		}

		if (!isObject(value) || !(key in target) || isClass(value)) {
			if ((override || !(key in target)) && !Object.isFrozen(target))
				try {
					target[key as keyof typeof target] = value as any
				} catch {}

			continue
		}

		if (!Object.isFrozen(target[key])) {
			seen ??= new WeakSet<object>()
			seen.add(source)
			try {
				target[key as keyof typeof target] = mergeDeep(
					(target as any)[key] as any,
					value,
					skipKeys,
					override,
					mergeArray,
					seen
				)
			} catch {}
		}
	}

	seen?.delete(source)

	return target as A & B
}

export const isBlob = (value: unknown): value is Blob =>
	value instanceof Blob || value instanceof ElysiaFile

export function cloneHook<T extends Partial<AnyLocalHook> | Partial<AppHook>>(
	src: T
): T {
	const out = nullObject() as Record<string, any>

	for (const key in src) {
		const value = (src as Record<string, any>)[key]
		out[key] = Array.isArray(value) ? value.slice() : value
	}

	return out as T
}

export function joinPath(base: string, path: string) {
	if (!path) return base

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

export const requestId = isBun
	? Bun.randomUUIDv7
	: // @ts-ignore
		(crypto.randomUUIDv7?.bind(crypto) ?? crypto.randomUUID?.bind(crypto))

export function replaceUrlPath(url: string, path: string) {
	const i = url.indexOf('/', 11)
	const qs = url.indexOf('?', i)

	return `${url.slice(0, i)}${path.charCodeAt(0) === 47 ? '' : '/'}${path}${qs === -1 ? '' : url.slice(qs)}`
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return false

	const proto = Object.getPrototypeOf(v)
	return proto === Object.prototype || proto === null
}

export function clonePlainDecorators<T extends Record<string, unknown>>(
	source: T,
	seen: WeakMap<object, any> = new WeakMap()
): T {
	const existing = seen.get(source)
	if (existing) return existing

	const out: Record<string, unknown> = nullObject()
	seen.set(source, out)

	for (const key in source) {
		const value = source[key]
		out[key] = isPlainObject(value)
			? clonePlainDecorators(value, seen)
			: value
	}

	return out as T
}
