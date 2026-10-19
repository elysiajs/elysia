import { dangerousKeys } from './constants'
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
	ElysiaFormData,
	AnySchema,
	MacroTypeLambda
} from './types'

// `beforeHandle` marks an occurrence of a derived function that runs as a
// plain hook, so later derive occurrences of it keep their role
export type DeriveEntry =
	| Function
	| readonly [Function, 'mapDerive' | 'beforeHandle']

export const nullObject = () => Object.create(null)
export const mapDeriveEntry = (fn: Function): DeriveEntry => [fn, 'mapDerive']

export const deriveEntryFn = (entry: DeriveEntry) =>
	Array.isArray(entry) ? entry[0] : entry

export const isMapDeriveEntry = (entry: DeriveEntry) =>
	Array.isArray(entry) && entry[1] === 'mapDerive'

export const isPlainDeriveEntry = (entry: DeriveEntry) =>
	Array.isArray(entry) && entry[1] === 'beforeHandle'

/**
 * `~deriveEntries` for `hooks` whose role per occurrence is `at` (an entry
 * for a derive, undefined for a plain hook). `deriveModes` gives each
 * function's entries to its occurrences in order, so a plain occurrence
 * before a derive of the same function gets a placeholder
 */
export function occurrenceDeriveEntries(
	hooks: readonly Function[],
	at: readonly (DeriveEntry | undefined)[]
): DeriveEntry[] {
	const derived = new Set<Function>()
	const entries: DeriveEntry[] = []

	// backwards: a plain occurrence needs a placeholder only before a derive
	for (let i = hooks.length; i--; ) {
		const entry = at[i]
		if (entry !== undefined) {
			entries.push(entry)
			derived.add(hooks[i]!)
		} else if (derived.has(hooks[i]!))
			entries.push([hooks[i]!, 'beforeHandle'])
	}

	// callers pass at least one entry
	return entries.reverse()
}

/** Each function's derive entries, in occurrence order */
export const deriveQueues = (entries: readonly DeriveEntry[] | undefined) =>
	entries && Map.groupBy(entries, deriveEntryFn)

export function isEmpty<T extends Object>(obj: T) {
	for (const _ in obj) return false

	return true
}

export const isNotEmpty = <T extends Object>(obj?: T) => obj && !isEmpty(obj)

const FNV_OFFSET_BASIS = 2166136261
const FNV_PRIME = 16777619

/**
 * @internal Generational cache eviction at cap, drop the oldest half.
 *
 * `map.delete(oldest)` per insert leaks ~1KB/eviction on JSC in ~1/3 of
 * processes (churned bucket cells permanently grow the heap and are never
 * reclaimed); clear + reinsert of the newest half measures clean and
 * amortizes to O(1) per insertion.
 */
export function evictOldestHalf(cache: Map<any, any>) {
	const keep = [...cache].slice(cache.size >> 1)
	cache.clear()
	for (const entry of keep) cache.set(entry[0], entry[1])
}

// from a previous result, it continues it: fnv1a(b, fnv1a(a)) is fnv1a(a + b)
export function fnv1a(str: string, hash = FNV_OFFSET_BASIS): number {
	const len = str.length

	for (let i = 0; i < len; i++) {
		hash ^= str.charCodeAt(i)
		hash = Math.imul(hash, FNV_PRIME)
	}

	return hash >>> 0
}

/**
 * 48-bit hash of a named plugin's key (fnv1a + 16 bits of a second hash): at
 * 32 bits two plugins collide by ~77k and the second is dropped. 48 keeps
 * `origin * 16 + slot` exact
 */
export function pluginHash(str: string) {
	let mix = 0x9e3779b9
	const len = str.length

	for (let i = 0; i < len; i++) {
		mix = Math.imul(mix ^ str.charCodeAt(i), 0x5bd1e995)
		mix ^= mix >>> 15
	}

	return (mix >>> 16) * 0x100000000 + fnv1a(str)
}

// keys whose members all apply; frozen so a plugin can't unsign cookies
export const compositionKeys: readonly string[] = Object.freeze([
	'allOf',
	'anyOf',
	'oneOf',
	'~cookieFrom'
])

// every schema a `$ref` name may resolve to: TypeBox picks the last `$id`
// match, so a cookie reader takes them all
export function refTargets(
	roots: unknown[],
	models: Record<string, unknown> = {}
): (name: string) => Iterable<unknown> {
	const targets: Record<string, Set<unknown>> = nullObject()
	const add = (name: string, schema: unknown) =>
		(targets[name] ??= new Set()).add(schema)

	const seen = new Set()
	const index = (node: any) => {
		if (!node || typeof node !== 'object' || seen.has(node)) return
		seen.add(node)

		if (typeof node.$id === 'string')
			add(node.$id.slice(node.$id.lastIndexOf('/') + 1), node)
		for (const key in node) index(node[key])
		index(node['~cookieFrom'])
	}

	for (const name in models) add(name, models[name])
	roots.concat(Object.values(models)).forEach(index)

	return (name) => targets[name] ?? []
}

// Macro-definition provenance: def → hash of the named plugin that registered
// to prevent collisions
// Used by `#use()` to skip macro merges from a plugin that has already been absorbed by parent
export const macroOrigin = new WeakMap<object | Function, number>()

/**
 * Id of `ref` in the registry at `globalThis['~elysiaSeedIds']`, `next` being
 * the last id handed out. Weak so it doesn't retain `ref`, realm-wide so every
 * installed Elysia copy agrees
 */
function realmId(ref: WeakKey) {
	const realm = globalThis as {
		'~elysiaSeedIds'?: { ids: WeakMap<WeakKey, number>; next: number }
	}
	const registry = (realm['~elysiaSeedIds'] ??= {
		ids: new WeakMap(),
		next: 0
	})

	let id = registry.ids.get(ref)
	if (id === undefined) registry.ids.set(ref, (id = ++registry.next))

	return id
}

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
 * `callback` is the chain of a `.group()`/`.guard()` callback the route came
 * out of: its error hooks cover every route the callback produced. Flattening
 * never reads it
 *
 * Use with {@link flattenChain} to walk tail-first and reconstruct
 * flat `Partial<AppHook>` at compile time
 */
export type ChainNode =
	| {
			added: Partial<AppHook>
			parent: ChainNode | undefined
			// self or anchestor carry string ref
			refs: boolean
			// Scope this node was registered at (`#on` / `#guard`).
			scope?: EventScope
			// True if this node was created by `#use`
			propagated?: boolean
			// Instance registered on, only if a scope child (local macros): others pin the plugin
			owner?: object
			// Hash of the named plugin this registration belongs to: the
			// registering instance, else the first named plugin it passed
			// through (Elysia 1 `checksum`)
			origin?: number
			// Node a propagated one copies: the registration itself
			registration?: ChainNode
	  }
	| {
			combine: ChainNode | undefined
			over: ChainNode | undefined
			callback?: ChainNode
			// the route's chain inside `callback`, the parent's left out
			inner?: ChainNode
			refs: boolean
	  }

export interface CompactBeforeHandleChunk {
	parent?: CompactBeforeHandleChunk
	values: readonly Function[]
}

export interface CompactBeforeHandlePrefix {
	tail?: CompactBeforeHandleChunk
	length: number
	previous?: CompactBeforeHandlePrefix
	added: readonly Function[]
}

const COMPACT_CHUNK_SIZE = 32
const emptyCompactBeforeHandlePrefix: CompactBeforeHandlePrefix = {
	length: 0,
	added: []
}
const compactBeforeHandleMemos = new WeakMap<
	ChainNode,
	CompactBeforeHandlePrefix | false
>()
const compactBeforeHandleFunctions = new WeakSet<Function>()

const compactBeforeHandleValues = (
	hook: Partial<AppHook> | undefined
): readonly Function[] | false => {
	if (!hook) return []

	for (const key in hook) if (key !== 'beforeHandle') return false

	const value = hook.beforeHandle
	if (value === undefined) return []
	if (typeof value === 'function') return [value]
	if (!Array.isArray(value)) return false
	for (let i = 0; i < value.length; i++)
		if (typeof value[i] !== 'function') return false

	return value.slice() as Function[]
}

export const isCompactBeforeHandleOnly = (hook: Partial<AppHook> | undefined) =>
	compactBeforeHandleValues(hook) !== false

export function compactBeforeHandleConflicts(
	hook: Partial<AppHook> | undefined
) {
	const values = compactBeforeHandleValues(hook)
	if (values === false) return true

	for (let i = 0; i < values.length; i++)
		if (compactBeforeHandleFunctions.has(values[i]!)) return true

	return false
}

export function compactBeforeHandlePrefix(start: ChainNode | undefined) {
	if (!start) return

	const pending: Array<{
		node: Extract<ChainNode, { added: Partial<AppHook> }>
		values: readonly Function[]
	}> = []

	let node: ChainNode | undefined = start
	let prefix = emptyCompactBeforeHandlePrefix

	while (node) {
		const cached = compactBeforeHandleMemos.get(node)
		if (cached) {
			prefix = cached
			break
		}

		if (cached === undefined && !('combine' in node)) {
			const values = compactBeforeHandleValues(node.added)
			if (values !== false) {
				pending.push({ node, values })
				node = node.parent
				continue
			}
		}

		compactBeforeHandleMemos.set(node, false)
		for (let i = 0; i < pending.length; i++)
			compactBeforeHandleMemos.set(pending[i]!.node, false)
		return
	}

	for (let i = pending.length - 1; i >= 0; i--) {
		const item = pending[i]!
		const added = item.values

		if (added.length) {
			let tail = prefix.tail
			let length = prefix.length

			for (let j = 0; j < added.length; j++) {
				const fn = added[j]!
				compactBeforeHandleFunctions.add(fn)

				if (tail && tail.values.length < COMPACT_CHUNK_SIZE)
					tail = {
						parent: tail.parent,
						values: [...tail.values, fn]
					}
				else tail = { parent: tail, values: [fn] }
				length++
			}

			prefix = {
				tail,
				length,
				previous: prefix.length ? prefix : undefined,
				added
			}
		}

		compactBeforeHandleMemos.set(item.node, prefix)
	}

	return prefix.length ? prefix : undefined
}

// A chain entry installs one plugin's lifecycle event, as the pair
// `origin * 16 + slot`; a slot is the event's index in `lifecycleEvents`
// (Elysia 1 compares checksums per event array). `derive` lowers into
// `beforeHandle` but is its own lifecycle; schemas never deduplicate
const deriveSlot = 15

const withLayer = (outer: ReadonlySet<number> | undefined, layer: number[]) =>
	new Set([...(outer ?? []), ...layer])

export interface ChainInfo {
	// `(plugin, lifecycle)` pairs the chain installs
	installs?: ReadonlySet<number>
	// any registration belongs to a named plugin
	named?: true
}

/**
 * Walk the chain tail-first into a fresh `Partial<AppHook>`
 *
 * Each instance chain a combine node links is one layer, outermost first.
 * A named plugin's hook is skipped when an outer layer, or `skip`, already
 * installed that plugin's same lifecycle event: it runs once, at its
 * outermost position. Within a layer every registration stays
 *
 * Explicit-stack walk (no recursion) so it works uniformly for linear
 * chains and combine nodes without risking stack overflow on deep chains
 */
export function flattenChain(
	start: ChainNode | undefined,
	resolveAdded?: (node: ChainNode) => Partial<AppHook> | undefined,
	skip?: ReadonlySet<number>,
	info?: ChainInfo
): Partial<AppHook> | undefined {
	if (!start) return
	const result = nullObject() as Partial<AppHook>

	// local: a shared stack keeps the capacity of the longest chain walked
	const nodes: ChainNode[] = [start]
	const phases: number[] = [0]

	// installed by the outer layers, by the current one
	let outer = skip
	let layer: number[] | undefined
	// derive entry of each `beforeHandle` occurrence, once one is a derive
	let roles: (DeriveEntry | undefined)[] | undefined
	// narrowest wins, local > plugin > global like the inferred route type
	let ranks: Record<string, number> | undefined

	while (nodes.length) {
		const node = nodes.pop()!
		const phase = phases.pop()!

		// end of a layer: it is outer to the rest
		if (phase === 2) {
			if (layer?.length) {
				outer = withLayer(outer, layer)
				layer.length = 0
			}

			// an inner layer is closer to the route
			ranks = undefined

			continue
		}

		if (phase === 1) {
			// only a registration node gets here, never a combine one
			const { origin, propagated, scope } = node as Extract<
				ChainNode,
				{ added: unknown }
			>
			if (info && origin !== undefined) info.named = true

			const added = resolveAdded
				? resolveAdded(node)
				: (node as { added: Partial<AppHook> }).added

			const base =
				origin !== undefined &&
				(propagated || scope === 'plugin' || scope === 'global')
					? origin * 16
					: undefined

			const derives = deriveQueues(
				(added as { '~deriveEntries'?: DeriveEntry[] })?.[
					'~deriveEntries'
				]
			)

			if (added)
				for (const key in added) {
					const v = (added as any)[key]
					// `~deriveEntries` is rebuilt per occurrence below
					if (v == null || key === '~deriveEntries') continue

					const slot = lifecycleEvents.indexOf(key)

					if (key === 'beforeHandle') {
						for (const fn of Array.isArray(v) ? v : [v]) {
							const entry = derives?.get(fn)?.shift()

							if (base !== undefined) {
								const pair =
									base +
									(entry === undefined ? slot : deriveSlot)
								if (outer?.has(pair)) continue
								;(layer ??= []).push(pair)
							}

							const list = (result.beforeHandle ??=
								[]) as Function[]
							if (entry !== undefined)
								(roles ??= [])[list.length] = entry
							list.push(fn)
						}

						continue
					}

					if (base !== undefined && slot !== -1) {
						if (outer?.has(base + slot)) continue
						// no hook, no installation
						if (!Array.isArray(v) || v.length)
							(layer ??= []).push(base + slot)
					}

					if (slot !== -1 || key === 'schemas') {
						const existing = (result as any)[key]

						if (Array.isArray(v)) {
							if (existing)
								for (let i = 0; i < v.length; i++)
									existing.push(v[i])
							else (result as any)[key] = v.slice()
						} else if (existing) existing.push(v)
						else (result as any)[key] = [v]
					} else if (schemaProperties.has(key)) {
						// a propagated `plugin` hook is the parent's own
						const rank =
							scope === 'global'
								? 0
								: scope === 'plugin' && !propagated
									? 1
									: 2

						const held: Record<string, number> = (ranks ??=
							nullObject())
						if (rank < (held[key] ?? 0)) continue

						held[key] = rank
						;(result as any)[key] = v
					} else (result as any)[key] = v
				}

			continue
		}

		if ('combine' in node) {
			if (node.combine) {
				nodes.push(node.combine)
				phases.push(0)
			}

			if (node.over) {
				nodes.push(node)
				phases.push(2)
				nodes.push(node.over)
				phases.push(0)
			}
		} else {
			// Append self after its parent has been visited/appended.
			nodes.push(node)
			phases.push(1)
			if (node.parent) {
				nodes.push(node.parent)
				phases.push(0)
			}
		}
	}

	if (info) info.installs = layer?.length ? withLayer(outer, layer) : outer

	if (roles)
		(result as any)['~deriveEntries'] = occurrenceDeriveEntries(
			result.beforeHandle as Function[],
			roles
		)

	if (isNotEmpty(result)) return result
}

/**
 * whenever any macro table mutates (`.macro()` / `#use` merge)
 * every macro-resolution memo flattens, localHook/chainNode memos
 * validates against the current epoch
 *
 * @see `compile/handler`
 */
let macroTableEpoch = 0

export const macroEpoch = () => macroTableEpoch
export const invalidateMacroEpoch = () => {
	macroTableEpoch++
}

interface FlattenMemo {
	e: number
	per: WeakMap<ChainNode, Partial<AppHook>>
	info: WeakMap<ChainNode, ChainInfo>
	skipped?: WeakMap<ChainNode, WeakMap<object, Partial<AppHook>>>
}

const flattenChainMemos = new WeakMap<object, FlattenMemo>()

/** Drop this root's flattened-chain memo. Recomputable on next compile. */
export function clearFlattenChainMemo(root: object) {
	flattenChainMemos.delete(root)
}

const emptyFlatten = Object.freeze(nullObject()) as Partial<AppHook>

function flattenMemoOf(root: object) {
	let bucket = flattenChainMemos.get(root)
	if (!bucket || bucket.e !== macroTableEpoch) {
		bucket = { e: macroTableEpoch, per: new WeakMap(), info: new WeakMap() }
		flattenChainMemos.set(root, bucket)
	}

	return bucket
}

/** What the chain installs, see {@link flattenChain} */
export function flattenChainInfo(
	root: object,
	start: ChainNode | undefined,
	resolveAdded?: (node: ChainNode) => Partial<AppHook> | undefined
): ChainInfo | undefined {
	if (!start) return

	// the bucket from before resolving: a macro may move the epoch on
	const bucket = flattenMemoOf(root)
	flattenChainMemoReadonly(root, start, resolveAdded)

	// none kept for a chain without a named plugin
	return bucket.info.get(start)
}

export function flattenChainMemoReadonly(
	root: object,
	start: ChainNode | undefined,
	resolveAdded?: (node: ChainNode) => Partial<AppHook> | undefined,
	skip?: ReadonlySet<number>
): Partial<AppHook> | undefined {
	if (!start) return

	const bucket = flattenMemoOf(root)

	// a flatten that skips is memoized per skip set
	let memo: WeakMap<object, Partial<AppHook>> = bucket.per
	if (skip) {
		const skipped = (bucket.skipped ??= new WeakMap())
		memo = skipped.get(start)!
		if (!memo) skipped.set(start, (memo = new WeakMap()))
	}

	let cached = memo.get(skip ?? start)
	if (cached === undefined) {
		// what the chain itself installs, not a skipping flatten
		const info: ChainInfo | undefined = skip ? undefined : {}
		cached = flattenChain(start, resolveAdded, skip, info) ?? emptyFlatten
		memo.set(skip ?? start, cached)

		if (info?.named) bucket.info.set(start, info)
	}

	if (cached !== emptyFlatten) return cached
}

export function flattenChainMemo(
	root: object,
	start: ChainNode | undefined,
	resolveAdded?: (node: ChainNode) => Partial<AppHook> | undefined,
	skip?: ReadonlySet<number>
): Partial<AppHook> | undefined {
	const cached = flattenChainMemoReadonly(root, start, resolveAdded, skip)
	if (cached) return cloneHook(cached)
}

// eslint-disable-next-line no-control-regex
const notLatin = /[^\x00-\xFF]/

/**
 *
 * @param url URL to redirect to
 * @param HTTP status code to send,
 */
export const redirect = (
	url: string,
	status: 301 | 302 | 303 | 307 | 308 = 302
) =>
	new Response(null, {
		status,
		headers: { location: notLatin.test(url) ? encodeURI(url) : url }
	})

export type redirect = typeof redirect

class ElysiaForm {}
Object.defineProperty(ElysiaForm, 'name', { value: 'ElysiaForm' })
export const ELYSIA_FORM_PROTOTYPE: object = ElysiaForm.prototype

export const isElysiaForm = (value: unknown): boolean =>
	value instanceof ElysiaForm ||
	(value != null &&
		Object.getPrototypeOf(value)?.constructor?.name === 'ElysiaForm')

function appendFormField(formData: FormData, key: string, value: unknown) {
	if (value === undefined || value === null) return

	if (value instanceof Blob) formData.append(key, value)
	else if (value instanceof ElysiaFile)
		formData.append(key, value.value as Blob)
	else if (typeof value === 'object')
		formData.append(key, JSON.stringify(value))
	else formData.append(key, '' + value)
}

export function formToFormData(value: Record<keyof any, unknown>) {
	const formData = new FormData()

	for (const key in value) {
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
	// Spread, never `Object.assign`: spread *defines* own data properties, while
	// `Object.assign` *assigns* them and so invokes the inherited `__proto__`
	// setter. A body parsed from `{"__proto__":{…}}` owns a real `__proto__`
	// key, so assigning it would hand the caller's input control of this
	// object's prototype — and therefore of response dispatch — the moment
	// anyone writes `form(body)`. `setPrototypeOf` after the copy is the brand.
	Object.setPrototypeOf(
		{ ...value },
		ELYSIA_FORM_PROTOTYPE
	) as unknown as ElysiaFormData<T>

export const macroType = <L extends MacroTypeLambda>() =>
	undefined as L | undefined

export const assignOwn = <T extends object>(target: T, source: any): T =>
	source != null && Object.hasOwn(source, '__proto__')
		? Object.defineProperties(
				target,
				Object.getOwnPropertyDescriptors(source)
			)
		: Object.assign(target, source)

export const getLoosePath = (path: string) =>
	path.charCodeAt(path.length - 1) === 47 ? path.slice(0, -1) : path + '/'

import type { SSEPayload, Prettify, BunHTMLBundlelike } from './types'

const byteStreams = new WeakSet<ReadableStream<Uint8Array>>()

/**
 * Certify a byte stream for direct Response body pass-through.
 *
 * The returned Response owns this exact stream. Cancel it through the response
 * body reader; preserving identity means Elysia does not install a second
 * request-signal reader after the body is locked.
 */
export function bytes<T extends ReadableStream<Uint8Array>>(stream: T): T {
	byteStreams.add(stream)

	return stream
}

export const isByteStream = (
	value: unknown
): value is ReadableStream<Uint8Array> =>
	typeof value === 'object' && value !== null && byteStreams.has(value as any)

type FormatSSEPayload<T = unknown> = T extends string
	? { readonly data: T }
	: Prettify<SSEPayload<T>>

const sseLineBreak = /\r\n|\r|\n/g

const sseField = (name: 'id' | 'event', value: string | number) =>
	`${name}: ${(value + '').replace(sseLineBreak, '')}\n`

export const sseData = (value: string) => {
	if (value.indexOf('\n') === -1 && value.indexOf('\r') === -1)
		return 'data: ' + value + '\n'

	return value
		.split(sseLineBreak)
		.map((line) => `data: ${line}\n`)
		.join('')
}

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
			s += sseField('id', payload.id)
		if (payload.event) s += sseField('event', payload.event)
		if (
			typeof payload.retry === 'number' &&
			Number.isFinite(payload.retry) &&
			payload.retry >= 0
		)
			s += `retry: ${Math.trunc(payload.retry)}\n`
		if (payload.data === null) s += 'data: null\n'
		else if (typeof payload.data === 'string') s += sseData(payload.data)
		else if (typeof payload.data === 'object')
			s += `data: ${JSON.stringify(payload.data)}\n`
		// number / boolean / bigint: `data: 0` is a valid event, not an empty one
		else if (payload.data !== undefined) s += sseData(String(payload.data))

		if (s) s += '\n'
		return s
	}

	return payload as any
}

const _enc = new TextEncoder()

// Materialising `node:crypto` costs ~565 KB / 5.2k objects of native module
// only allocate when need
let _constantTimeEqual: ((a: string, b: string) => boolean) | undefined

const _resolveConstantTimeEqual = (): ((a: string, b: string) => boolean) => {
	let native: ((a: Uint8Array, b: Uint8Array) => boolean) | undefined

	// Bun's global `crypto.timingSafeEqual` is the same native function as
	// `node:crypto`'s (BoringSSL `CRYPTO_memcmp`), without loading the module
	if (isBun && typeof (crypto as any)?.timingSafeEqual === 'function')
		native = (a: Uint8Array, b: Uint8Array) =>
			(crypto as any).timingSafeEqual(a, b)
	else
		try {
			const _crypto = (globalThis.process as any)?.getBuiltinModule?.(
				'node:crypto'
			)

			if (typeof _crypto?.timingSafeEqual === 'function')
				native = _crypto.timingSafeEqual as (
					a: Uint8Array,
					b: Uint8Array
				) => boolean
		} catch {}

	if (!native)
		return (a: string, b: string) => {
			if (a.length !== b.length) return false

			let mismatch = 0
			for (let i = 0; i < a.length; i++)
				mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)

			return mismatch === 0
		}

	const compare = native

	return (a: string, b: string) => {
		const ab = _enc.encode(a)
		const bb = _enc.encode(b)

		return ab.length !== bb.length ? false : compare(ab, bb)
	}
}

export const constantTimeEqual = (a: string, b: string) =>
	(_constantTimeEqual ??= _resolveConstantTimeEqual())(a, b)

export const isRecordNumber = (
	x: Record<keyof object, unknown> | undefined
): x is Record<number, unknown> => {
	if (typeof x !== 'object') return false

	const keys = Object.keys(x)
	return keys.length > 0 && keys.every((k) => !isNaN(+k))
}

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

const hookSchemaKeys = [
	'body',
	'headers',
	'params',
	'query',
	'cookie',
	'response'
] as const

export const schemaProperties = new Set<string>(hookSchemaKeys)

const hookEventKeys = [
	'parse',
	'transform',
	'derive',
	'beforeHandle',
	'afterHandle',
	'mapResponse',
	'afterResponse',
	'error',
	'trace'
] as const

// an event's index is its slot in `flattenChain`
const lifecycleEvents = [
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
]

export const eventProperties = new Set(lifecycleEvents)

export function hookToGuard(
	a: Partial<AppHook & Macro> & {
		schema?: GuardSchemaType
	}
): Partial<AppHook & Macro> {
	if (a.schema !== 'merge') {
		// Anything else would silently apply the default override channel: a
		// 1.x `schema: 'standalone'` guard stops validating the routes under it
		if (a.schema !== undefined && a.schema !== 'override')
			throw new Error(
				`[Elysia] Invalid guard schema ${JSON.stringify(a.schema)}, expected 'merge' or 'override' (1.x 'standalone' is 'merge')`
			)

		return a
	}

	if (a.body || a.headers || a.params || a.query || a.cookie || a.response) {
		a.schemas ??= []
		const schema = Object.create(null)

		for (const key of hookSchemaKeys)
			if (a[key]) {
				schema[key] = a[key]
				a[key] = undefined
			}

		a.schemas.push(schema)
	}

	return a
}

export function coalesceSchemas(existing: any[], incoming: any[]) {
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
				// Replace the slot with a fresh merged object instead of
				// mutating `e` in place
				existing[i] = Object.assign(nullObject(), e, entry)
				merged = true
				break
			}
		}

		if (!merged) existing.push(entry)
	}
}

export function mergeHook(
	a: Partial<AppHook>,
	b: Partial<AppHook> | undefined
): Partial<AppHook> {
	if (!b) return a
	if (!a) return b

	for (const key of hookSchemaKeys)
		if (!a[key] && b[key]) a[key] = b[key] as any
		else if (key === 'response' && a.response && b.response)
			a.response = mergeResponse(b.response, a.response) as any

	for (const key of hookEventKeys)
		if ((a as any)[key] || (b as any)[key])
			(a as any)[key] = mergeArray((a as any)[key], (b as any)[key], true)

	if (a.schemas || b.schemas)
		a.schemas = mergeArray(a.schemas, b.schemas, true) as any

	const aDerive = (a as any)['~deriveEntries']
	const bDerive = (b as any)['~deriveEntries']
	if (aDerive || bDerive)
		(a as any)['~deriveEntries'] = mergeArray(aDerive, bDerive, true)

	return a
}

export const createErrorEventHandler = (fn: EventFn<'error'>, error: Error) => {
	const handler = (context: Context) => {
		if (
			// @ts-expect-error
			context.error instanceof
			// @ts-expect-error
			(error as unknown as Error)
		)
			return fn!(context as any)
	}

	const prototype = (error as any)?.prototype
	if (
		typeof prototype === 'object' &&
		prototype !== null &&
		prototype !== Error.prototype &&
		!(prototype instanceof Error)
	)
		(handler as any)['~errorClass'] = error

	return handler
}

const isObject = (item: any): item is Object =>
	item && typeof item === 'object' && !Array.isArray(item)

const isClassRegex = /^\s*class\s+/
const isClass = (v: Object) =>
	(typeof v === 'function' && isClassRegex.test(v.toString())) ||
	// built-in tag, not `v.toString()`: Date, Map, URL, typed arrays,
	// `import * as X` ([object Module]) and Symbol.toStringTag values like
	// [object Prisma]; plain and Object.create(null) objects read [object Object]
	Object.prototype.toString.call(v) !== '[object Object]' ||
	// custom marker: FFI values whose own toString() returns '[object X]'
	(v.toString &&
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
	seen?: WeakSet<object>,
	cloneAdopt?: { map?: WeakMap<object, any> }
): A & B {
	if (!isObject(target) || !isObject(source)) return target as A & B
	if (seen?.has(source)) return target as A & B

	const keys = Object.keys(source)
	const targetFrozen = Object.isFrozen(target)

	for (let i = 0; i < keys.length; i++) {
		const key = keys[i]

		const value = source[key]
		if (skipKeys?.includes(key) || dangerousKeys.has(key as any)) continue

		if (mergeArray && Array.isArray(value)) {
			const existing = (target as any)[key]

			target[key as keyof typeof target] = (
				Array.isArray(existing) ? existing.concat(value) : value
			) as any

			continue
		}

		const valueIsObject = isObject(value)

		if (!valueIsObject || !(key in target) || isClass(value)) {
			if ((override || !(key in target)) && !targetFrozen)
				try {
					target[key as keyof typeof target] = (
						valueIsObject &&
						cloneAdopt !== undefined &&
						isPlainObject(value)
							? clonePlainDecorators(
									value,
									(cloneAdopt.map ??= new WeakMap())
								)
							: value
					) as any
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
					seen,
					cloneAdopt
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

export function clonePlainDeep<T>(value: T, seen?: WeakMap<object, any>): T {
	if (Array.isArray(value)) {
		seen ??= new WeakMap()

		const hit = seen.get(value)
		if (hit) return hit

		const out: unknown[] = []
		seen.set(value, out)

		for (let i = 0; i < value.length; i++)
			out[i] = clonePlainDeep((value as unknown[])[i], seen)

		return out as T
	}

	if (isPlainObject(value)) {
		seen ??= new WeakMap()
		const hit = seen.get(value)
		if (hit) return hit
		const out = nullObject() as Record<string, unknown>
		seen.set(value, out)
		for (const key in value)
			out[key] = clonePlainDeep(
				(value as Record<string, unknown>)[key],
				seen
			)

		return out as T
	}

	return value
}

export function guardNonPlainLeaves(
	target: Record<string, unknown>,
	source: Record<string, unknown>
) {
	for (const key in source) {
		if (!Object.hasOwn(source, key)) continue

		const sv = source[key]
		if (!isObject(sv) || isClass(sv)) continue

		const tv = target[key]
		if (tv === undefined || !isObject(tv)) continue

		if (isPlainObject(tv)) {
			guardNonPlainLeaves(tv, sv as Record<string, unknown>)
			continue
		}

		target[key] = clonePlainDeep(sv)
	}
}

export function joinPath(base: string, path: string) {
	if (!path) return base

	const baseEndsWithSlash = base.charCodeAt(base.length - 1) === 47
	const pathStartsWithSlash = path.charCodeAt(0) === 47

	if (baseEndsWithSlash && pathStartsWithSlash) return base + path.slice(1)
	if (!baseEndsWithSlash && !pathStartsWithSlash) return base + '/' + path

	return base + path
}

export const requestId = isBun
	? Bun.randomUUIDv7
	: crypto.randomUUID.bind(crypto)

/**
 * Offset of the first byte after `://`, so the authority is never scanned as
 * path. A fixed offset would let the client-supplied `Host` decide how many
 * leading path bytes are dropped
 */
export const authorityEnd = (url: string) =>
	url.charCodeAt(4) === 58
		? 7
		: url.charCodeAt(5) === 58
			? 8
			: url.indexOf('://') + 3

export function replaceUrlPath(url: string, path: string) {
	const i = url.indexOf('/', authorityEnd(url))
	const qs = url.indexOf('?', i)

	return `${url.slice(0, i)}${path.charCodeAt(0) === 47 ? '' : '/'}${path}${qs === -1 ? '' : url.slice(qs)}`
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return false

	const proto = Object.getPrototypeOf(v)
	return proto === Object.prototype || proto === null
}

export function clonePlainDecorators<T extends Record<string, unknown>>(
	source: T,
	seen = new WeakMap<object, any>()
): T {
	const existing = seen.get(source)
	if (existing) return existing

	const out: Record<PropertyKey, unknown> = nullObject()
	seen.set(source, out)

	// `for..in`: inherited keys included, one an earlier getter deletes skipped
	for (const key in source) copyKey(source, out, key, seen)

	// then the own keys it skips (symbol or non-enumerable), best effort: a
	// getter that throws on one skips the key, not the `.use()`
	const own = Reflect.ownKeys(source)
	if (own.length !== Object.keys(source).length)
		for (const key of own) {
			const descriptor = Object.getOwnPropertyDescriptor(source, key)
			if (
				!descriptor ||
				(descriptor.enumerable && typeof key === 'string')
			)
				continue

			try {
				copyKey(source, out, key, seen, descriptor)
			} catch {}
		}

	if (!Object.isExtensible(source)) Object.preventExtensions(out)

	return out as T
}

const copyKey = (
	source: object,
	out: Record<PropertyKey, unknown>,
	key: PropertyKey,
	seen: WeakMap<object, any>,
	descriptor = Object.getOwnPropertyDescriptor(source, key)
) => {
	// a getter runs once, here: the copy keeps what it returned
	let value = (source as any)[key]
	if (isPlainObject(value)) value = clonePlainDecorators(value, seen)

	// `out` has no prototype, so assigning a key defines it
	// only a read-only, hidden or non-configurable need to be spelled out
	if (
		!descriptor ||
		(descriptor.writable !== false &&
			descriptor.enumerable &&
			descriptor.configurable)
	)
		out[key] = value
	else
		Object.defineProperty(out, key, {
			value,
			writable: descriptor.writable ?? true,
			enumerable: descriptor.enumerable,
			configurable: descriptor.configurable
		})
}

function prefix<T extends string, Models extends Record<string, AnySchema>>(
	prefix: T,
	models: Models
): {
	[k in keyof Models as `${T}.${k & string}`]: Models[k]
} {
	const prefixed: Record<string, AnySchema> = nullObject()
	for (const key in models) prefixed[`${prefix}.${key}`] = models[key]

	return prefixed as any
}

prefix.capitalize = function prefixModelsCapitalize<
	T extends string,
	Models extends Record<string, AnySchema>
>(
	prefix: T,
	models: Models
): {
	[k in keyof Models as `${T}.${Capitalize<k & string>}`]: Models[k]
} {
	const prefixed: Record<string, AnySchema> = nullObject()

	for (const key in models)
		prefixed[`${prefix}.${key.charAt(0).toUpperCase() + key.slice(1)}`] =
			models[key]

	return prefixed as any
}

// A function or symbol is tagged `\0ref:`, which older copies never wrote:
// their per-copy `\0fn:` ids count from 1 too
export function serializeMacroSeed(_key: string, value: unknown) {
	switch (typeof value) {
		case 'function':
			return '\0ref:' + realmId(value)

		case 'bigint':
			return '\0bigint:' + (value as bigint).toString()

		case 'symbol': {
			// A registered symbol can't be a WeakMap key, but its key names it
			const key = Symbol.keyFor(value as symbol)

			return key === undefined
				? '\0ref:' + realmId(value as symbol)
				: '\0symfor:' + key
		}

		case 'undefined':
			return '\0undefined'

		default:
			return value
	}
}

export const throwLifecycleErrors = (errors: unknown[]) => {
	if (errors.length === 1) throw errors[0]
	if (errors.length)
		throw new AggregateError(errors, 'Multiple lifecycle failures')
}

export const isDisposable = (value: any) => {
	if (value == null) return false

	const kind = typeof value
	if (kind !== 'object' && kind !== 'function') return false

	try {
		return (
			typeof value[Symbol.asyncDispose] === 'function' ||
			typeof value[Symbol.dispose] === 'function'
		)
	} catch {
		return false
	}
}

const singletons = new WeakSet<object>()
export const isSingleton = (value: object) => singletons.has(value)

function pushHeld(object: object, into: object[], seen: Set<object>) {
	if (ArrayBuffer.isView(object)) return

	let all = false
	try {
		all =
			typeof object !== 'function' &&
			object !== globalThis &&
			!(object instanceof Error)
	} catch {}

	try {
		const keys = all
			? Reflect.ownKeys(object)
			: [...Object.keys(object), ...Object.getOwnPropertySymbols(object)]

		for (const key of keys) {
			const descriptor = Object.getOwnPropertyDescriptor(object, key)
			if (descriptor && 'value' in descriptor)
				enqueue(descriptor.value, into, seen)
		}
	} catch {}
}

// mark and queue `value` once, however many paths reach it
function enqueue(value: unknown, into: object[], seen: Set<object>) {
	if (value == null) return

	const kind = typeof value
	if (kind !== 'object' && kind !== 'function') return

	const object = value as object
	if (seen.has(object)) return

	seen.add(object)
	singletons.add(object)
	into.push(object)
}

function markLevels(level: object[], depth: number, seen: Set<object>) {
	while (level.length && depth > 0) {
		const next: object[] = []
		for (const object of level) pushHeld(object, next, seen)

		level = next
		depth--
	}
}

export const markSingletons = (value: unknown, depth = 4) => {
	const seen = new Set<object>()
	const level: object[] = []
	enqueue(value, level, seen)
	markLevels(level, depth, seen)
}

// `markSingletons` on each value `object` holds
export const markPropertySingletons = (object: object) => {
	const seen = new Set<object>()
	const level: object[] = []
	pushHeld(object, level, seen)
	markLevels(level, 4, seen)
}

export const isSocketQuiet = (socket: {
	readyState: number
	data: { inflight?: number; opening?: unknown; settling?: number }
}) =>
	socket.readyState === 3 &&
	!socket.data.inflight &&
	!socket.data.opening &&
	!socket.data.settling

export const isHTMLBundle = (value: unknown): value is BunHTMLBundlelike =>
	Object.prototype.toString.call(value) === '[object HTMLBundle]' ||
	(typeof (value as BunHTMLBundlelike)?.index === 'string' &&
		Array.isArray((value as { files?: unknown }).files))

export { prefix }
