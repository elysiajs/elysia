import type { AnyElysia } from '../../base'
import type { ElysiaAdapter } from '../../adapter'

import { defaultAdapter } from '../../adapter/constants'
import { mapResponse } from '../../adapter/web-standard/handler'
import { ElysiaFile } from '../../universal/file'
import { ElysiaStatus } from '../../error'

import { Capture, Compiled, aotDriftMessage, warnAotDrift } from '../aot'
import { frozenRootOf } from '../../generation'
import { isResponseParam, resolveHandlerParams } from './params'
import { compileHandlerJit, createInlineHandler, targetsBun } from './jit'
export { setCaptureHeaderShorthand } from './jit'
export { releaseAnalysisCaches } from './descriptor'
import { returnedErrorClasses } from '../../handler/utils'
import { deriveModes, joinDeriveEntries } from './utils'
import { isAsyncFunction } from '../utils'
import { originalFunction } from '../../type/shared'
import { describeRoute } from './descriptor'
import { Reconstruct } from './reconstruct'
import { isResponseMap } from './frozen-validator'
import type { Context } from '../../context'
import {
	cloneHook,
	compactBeforeHandleConflicts,
	compactBeforeHandlePrefix,
	compositionKeys,
	flattenChain,
	flattenChainInfo,
	flattenChainMemo,
	flattenChainMemoReadonly,
	fnv1a,
	isCompactBeforeHandleOnly,
	isNotEmpty,
	isRecordNumber,
	macroEpoch,
	mergeHook,
	nullObject,
	refTargets,
	replaceUrlPath,
	isHTMLBundle,
	type ChainNode
} from '../../utils'

import type {
	CompiledHandler,
	InternalRoute,
	AnyLocalHook,
	AppHook
} from '../../types'

function applyHook(
	localHook: Partial<AnyLocalHook> | undefined,
	// from `flattenChainMemo`: already a clone, safe to mutate
	appHook: Partial<AnyLocalHook> | undefined,
	rootHook: Partial<AppHook> | undefined
): AnyLocalHook | undefined {
	let hook: any

	if (localHook && appHook)
		hook = mergeHook(cloneHook(localHook) as any, appHook as any)
	else {
		const base = localHook ? cloneHook(localHook as any) : appHook
		if (!rootHook) return base as any

		hook = base ?? nullObject()
	}

	if (rootHook) mergeHook(hook, rootHook as any)

	return hook
}

function promoteDerive(hook: any) {
	const derive = hook.derive
	if (derive === undefined) return

	const arr = Array.isArray(derive) ? derive : [derive]

	if (arr.length) {
		const existing = hook.beforeHandle

		hook.beforeHandle = existing
			? Array.isArray(existing)
				? [...arr, ...existing]
				: [...arr, existing]
			: arr

		const entries = (hook['~deriveEntries'] ??= [])
		for (let i = 0; i < arr.length; i++) entries.push(arr[i])
	}

	hook.derive = undefined
}

// macro `introspect`s queued by `~applyMacro`, run once the hooks they
// inspect are all merged
export function runIntrospect(hook: any) {
	const introspects = hook?.['~introspect']
	if (!introspects) return

	// the status map may be shared, so an introspect rewrites a copy
	if (hook.response && isRecordNumber(hook.response))
		hook.response = { ...hook.response }

	for (let i = 0; i < introspects.length; i++) introspects[i](hook)

	delete hook['~introspect']
}

type ResolutionMemo = WeakMap<
	object,
	{ e: number; per: WeakMap<object, WeakMap<object, any>> }
>

function memoScope(
	memos: ResolutionMemo,
	root: object,
	scope: object
): WeakMap<object, any> {
	let bucket = memos.get(root)
	if (!bucket || bucket.e !== macroEpoch()) {
		bucket = { e: macroEpoch(), per: new WeakMap() }

		memos.set(root, bucket)
	}

	let perScope = bucket.per.get(scope)
	if (!perScope) {
		perScope = new WeakMap()
		bucket.per.set(scope, perScope)
	}

	return perScope
}

function hasMacroKey(
	hook: object,
	scopeMacro: object | undefined,
	rootMacro: object | undefined
) {
	if (scopeMacro || rootMacro)
		for (const key in hook)
			if (
				(scopeMacro && key in scopeMacro) ||
				(rootMacro && key in rootMacro)
			)
				return true

	return false
}

function applyMacros(
	hook: any,
	scope: AnyElysia,
	frozenRoot: ReturnType<typeof frozenRootOf>,
	scopeMacro: object | undefined,
	rootMacro: object | undefined
) {
	if (scopeMacro) {
		frozenRootOf(scope)['~applyMacro'](hook)

		if (rootMacro) for (const k in hook) if (k in scopeMacro) delete hook[k]
	}

	if (rootMacro) frozenRoot['~applyMacro'](hook)
}

// Memo of resolved localHooks (route[4])
const localHookMemos: ResolutionMemo = new WeakMap()

export function resolveLocalHook(
	scope: AnyElysia,
	hook: Partial<AnyLocalHook> | undefined,
	root: AnyElysia = scope
): Partial<AnyLocalHook> | undefined {
	if (!hook) return hook

	const frozenRoot = frozenRootOf(root)
	const scopeMacro = frozenRootOf(scope)['~ext']?.macro
	const rootMacro = root === scope ? undefined : frozenRoot['~ext']?.macro
	if (!hasMacroKey(hook, scopeMacro, rootMacro)) return hook

	const perScope = memoScope(localHookMemos, root, scope)

	let resolved = perScope.get(hook)
	if (resolved === undefined) {
		resolved = cloneHook(hook)
		applyMacros(resolved, scope, frozenRoot, scopeMacro, rootMacro)
		perScope.set(hook, resolved)
	}

	return resolved
}

export function resolveWSLocalHook(
	scope: AnyElysia,
	hook: Partial<AnyLocalHook> | undefined,
	root: AnyElysia = scope
): Partial<AnyLocalHook> | undefined {
	const resolved = resolveLocalHook(scope, hook, root)
	if (
		!resolved ||
		((resolved as { derive?: unknown }).derive === undefined &&
			!resolved['~introspect'])
	)
		return resolved

	const owned = cloneHook(resolved)
	promoteDerive(owned)
	runIntrospect(owned)

	return owned
}

// Memo of resolved chain-node `added`
//
// Chain node (a `.guard`/`.group`/`.on` entry, possibly carrying a macro key)
// is shared by reference across every app that reuses the plugin it lives in
const chainNodeMemos: ResolutionMemo = new WeakMap()

/**
 * Drop this root's resolved-hook memos.
 * (JIT or rebuild) compile repopulates them anyway, just uncached
 */
export function clearHandlerAnalysisCaches(root: AnyElysia) {
	localHookMemos.delete(root)
	chainNodeMemos.delete(root)
}

function resolveChainNode(
	root: AnyElysia,
	node: ChainNode
): Partial<AppHook> | undefined {
	const added = (node as { added?: Partial<AppHook> }).added
	if (!added) return added

	const scope = localMacroRoot(
		((node as { owner?: object }).owner as AnyElysia) ?? root,
		root
	)

	const frozenRoot = frozenRootOf(root)
	const scopeMacro = frozenRootOf(scope)['~ext']?.macro
	const rootMacro = root === scope ? undefined : frozenRoot['~ext']?.macro
	const needsMacro = hasMacroKey(added, scopeMacro, rootMacro)

	if (!needsMacro && (added as { derive?: unknown }).derive === undefined)
		return added

	const perScope = memoScope(chainNodeMemos, root, scope)

	let resolved = perScope.get(added)
	if (resolved === undefined) {
		resolved = cloneHook(added)
		if (needsMacro)
			applyMacros(resolved, scope, frozenRoot, scopeMacro, rootMacro)

		promoteDerive(resolved)
		runIntrospect(resolved)
		perScope.set(added, resolved)
	}

	return resolved
}

export function chainResolver(root: AnyElysia) {
	const frozenRoot = frozenRootOf(root)
	return frozenRoot['~ext']?.macro || frozenRoot['~scopeChildren']
		? (node: ChainNode) => resolveChainNode(root, node)
		: undefined
}

export const localMacroRoot = (
	instance: AnyElysia,
	root: AnyElysia
): AnyElysia =>
	instance !== root &&
	(instance as { '~scopeChild'?: boolean })['~scopeChild'] === true &&
	frozenRootOf(instance)['~ext']?.macro
		? instance
		: root

/** Whether a hook can be skipped by a native static response. */
function isEmptyPipelineHook(hook: AnyLocalHook | undefined) {
	if (!hook) return true

	for (const key in hook) {
		if (key === 'detail' || key === 'tags' || key === 'error') continue

		const value = (hook as any)[key]
		if (
			value !== undefined &&
			value !== false &&
			(!Array.isArray(value) || value.length)
		)
			return false
	}

	return true
}

function mapStaticValue(
	response: ElysiaAdapter['response'],
	map: ElysiaAdapter['response']['map'],
	set: { headers: Record<string, string> },
	value: unknown
) {
	const mapped =
		map === mapResponse
			? mapResponse(value, set, null!)
			: Reflect.apply(map, response, [value, set])

	if (!(mapped instanceof Response)) return

	// Bun infers a string body's MIME only on the wire, and a per-request merge
	// re-wraps the body as a stream (octet-stream), so state it, also inside
	// a `status()` wrapper
	const body = value instanceof ElysiaStatus ? value.response : value
	if (
		(typeof body === 'string' ||
			typeof body === 'number' ||
			typeof body === 'boolean') &&
		!mapped.headers.has('content-type')
	)
		mapped.headers.set('content-type', 'text/plain;charset=utf-8')

	return mapped
}

export function buildNativeStaticResponse(
	route: InternalRoute,
	root: AnyElysia
) {
	const [
		,
		,
		handler,
		instance,
		localHook,
		appHook,
		inheritedChain,
		macroScope
	] = route

	if (
		typeof handler === 'function' ||
		handler instanceof Error ||
		handler instanceof Promise
	)
		return

	const frozenRoot = frozenRootOf(root)
	const adapter = frozenRoot['~config']?.adapter ?? defaultAdapter
	const ownedHook = resolveLocalHook(
		localMacroRoot(macroScope ?? instance, root),
		localHook,
		root
	)

	const resolve = chainResolver(root)
	const flatAppHook = flattenChainMemo(root, appHook as ChainNode, resolve)
	// what the parents had registered by the `.use()`: a later hook of theirs
	// never reaches a used route
	const rootHook =
		instance !== root
			? flattenChainMemoReadonly(root, inheritedChain, resolve)
			: undefined
	const hook = applyHook(ownedHook, flatAppHook as any, rootHook)

	if (hook && !isEmptyPipelineHook(hook as any)) return
	// `isEmptyPipelineHook` skips `error`: a registered class instance must
	// reach `compileHandler`, which throws it. A callback's error hooks count
	const callback =
		instance !== root
			? callbackErrors(inheritedChain, appHook, root, resolve)
			: undefined
	if (
		returnedErrorClasses({
			error: withCallbackErrors((hook as any)?.error, callback ?? [])
		})?.some((C) => handler instanceof (C as any))
	)
		return

	const rootHeaders = frozenRoot['~ext']?.headers
	if (handler instanceof Response && !rootHeaders) return handler

	const response = adapter.response
	const map = response.map
	const set = {
		headers: rootHeaders
			? Object.assign(nullObject(), rootHeaders)
			: nullObject()
	}

	return mapStaticValue(response, map, set, handler)
}

function toArray(name: string, hook: any) {
	if (typeof hook[name] === 'function') hook[name] = [hook[name]]
}

export function composeRouteHook(
	instance: AnyElysia,
	localHook: Partial<AnyLocalHook> | undefined,
	appHook: ChainNode | undefined,
	inheritedChain: ChainNode | undefined,
	root: AnyElysia,
	macroScope?: AnyElysia,
	// Only the HTTP JIT runs `~beforeHandlePrefix`. Any other consumer would
	// silently lose the inherited `beforeHandle` moved into it
	allowCompactPrefix = false
): AnyLocalHook | undefined {
	const resolve = chainResolver(root)
	localHook = resolveLocalHook(
		localMacroRoot(macroScope ?? instance, root),
		localHook,
		root
	)

	// Fold the macro `derive` into beforeHandle before merging with chain hooks
	if (localHook && (localHook as any).derive !== undefined) {
		localHook = cloneHook(localHook)
		promoteDerive(localHook)
	}

	const own = flattenChainInfo(root, appHook as ChainNode, resolve)
	let skip: ReadonlySet<number> | undefined
	if (own?.installs && instance !== root) {
		const outer = flattenChainInfo(root, inheritedChain, resolve)?.installs
		if (outer && !outer.isDisjointFrom(own.installs)) skip = outer
	}

	const flatAppHook = flattenChainMemo(
		root,
		appHook as ChainNode,
		resolve,
		skip
	)

	const callback =
		instance !== root
			? callbackErrors(inheritedChain, appHook, root, resolve)
			: undefined

	const compactPrefix =
		allowCompactPrefix &&
		instance !== root &&
		!Capture.isCapturing() &&
		!Capture.isAotBuildEnv() &&
		resolve === undefined &&
		isCompactBeforeHandleOnly(localHook as any) &&
		isCompactBeforeHandleOnly(flatAppHook as any) &&
		!callback
			? compactBeforeHandlePrefix(inheritedChain)
			: undefined

	if (
		compactPrefix &&
		!own?.named &&
		!compactBeforeHandleConflicts(localHook as any) &&
		!compactBeforeHandleConflicts(flatAppHook as any)
	) {
		let hook = applyHook(localHook, flatAppHook as any, undefined)

		hook ??= nullObject() as any
		;(hook as any)['~beforeHandlePrefix'] = compactPrefix
		return hook
	}

	// `inherited` is readonly
	const inherited =
		instance !== root
			? (flattenChainMemoReadonly(
					root,
					inheritedChain as any,
					resolve
				) as Partial<AppHook> | undefined)
			: undefined

	// derive or plain, per occurrence: one function may be both. Read
	// before the merge, which may write into these lists
	const deriveEntries = joinDeriveEntries([
		inherited,
		flatAppHook,
		localHook as Partial<AppHook>
	])

	let hook = applyHook(
		localHook,
		flatAppHook as any,
		inherited
			? (cloneHook(inherited as any) as Partial<AppHook>)
			: undefined
	)

	if (deriveEntries) (hook as any)['~deriveEntries'] = deriveEntries

	if (callback) {
		hook ??= nullObject() as any
		;(hook as any).error = withCallbackErrors((hook as any).error, callback)
	}

	return hook
}

/**
 * Error hooks of the `.group()`/`.guard()` callbacks a route came out of
 * innermost first (see `ChainNode`)
 */
function callbackErrors(
	start: ChainNode | undefined,
	appHook: ChainNode | undefined,
	root: AnyElysia,
	resolve: ((node: ChainNode) => Partial<AppHook> | undefined) | undefined
) {
	let out: Function[] | undefined
	// a callback's copy of a named plugin the route already has stays out
	let outer: ReadonlySet<number> | undefined | null = null

	for (let node = start; node && 'combine' in node; node = node.combine)
		if (node.callback) {
			if (outer === null)
				outer = flattenChainInfo(root, start, resolve)?.installs
			// most callbacks have no error hook
			if (
				!flattenChainMemoReadonly(root, node.callback, resolve, outer)
					?.error
			)
				continue

			// every registration the route has inside the callback, a
			// propagated copy as its original; the callback's own chain is not
			// the route's
			const has = new Set<ChainNode>()
			const collect = (n: ChainNode) => {
				has.add((n as { registration?: ChainNode }).registration ?? n)
				return undefined
			}
			flattenChain(node.inner, collect)
			flattenChain(appHook, collect)

			const error = flattenChain(
				node.callback,
				(n) =>
					has.has(
						(n as { registration?: ChainNode }).registration ?? n
					)
						? undefined
						: resolve
							? resolve(n)
							: (n as { added: Partial<AppHook> }).added,
				outer
			)?.error
			if (error) out = ([] as Function[]).concat(error, out ?? [])
		}

	return out
}

const withCallbackErrors = (
	own: Function | Function[] | undefined,
	callback: Function[]
) => ([] as Function[]).concat(own ?? [], callback)

const shapeEvents = [
	'parse',
	'transform',
	'beforeHandle',
	'afterHandle',
	'mapResponse',
	'afterResponse',
	'error',
	'trace'
] as const

const shapeSlots = ['body', 'headers', 'params', 'query', 'cookie', 'response']

const isCookieAt = (at: string) => at === 'cookie' || at === 'field'

// mirrors `gather` in cookie/config: a trailing `*` marks a container whose
// every value is a schema, `^` a Deferred's `parameters`
function childAt(at: string, k: string, value: unknown, deferred: boolean) {
	if (at.endsWith('*')) return at.slice(0, -1)
	if (at.endsWith('^'))
		return k === '0'
			? at.slice(0, -1) + (Array.isArray(value) ? '*' : '')
			: ''

	if (!isCookieAt(at)) return ''

	switch (k) {
		case '$ref':
			return at

		case 'properties':
			return at === 'cookie' ? 'field*' : ''

		case 'parameters':
			return deferred ? at + '^' : ''
	}

	return k === '$defs' || compositionKeys.includes(k) ? at + '*' : ''
}

// checksum of route compilation
export function routeShape(
	hook: AnyLocalHook | undefined,
	handler: unknown,
	root: AnyElysia
): number | undefined {
	const frozenRoot = frozenRootOf(root)
	const config = frozenRoot['~config']
	const models = frozenRoot['~ext']?.models as Record<string, unknown>

	// reference models
	const refs = new Map<string, string>()
	const addRef = (name: string, at = '') => {
		if (!isCookieAt(at)) at = ''
		if (at === 'cookie' || !refs.get(name)) refs.set(name, at)
	}

	const ids = new Map<Function, number>()
	const visiting = new Set<object>()
	let unsupported = false

	// polluted Object / Array prototype
	for (const _ in []) return

	// fnv1a of the canonical sequence, hashed as it is produced, never built
	let hash: number | undefined
	const feed = (s: string) => {
		hash = fnv1a(s, hash)
	}

	const quote = (s: string) => feed(JSON.stringify(s))

	const shape = (v: any, at = ''): void => {
		switch (typeof v) {
			case 'string':
				return quote(v)

			case 'number':
				return feed('n' + (Object.is(v, -0) ? '-0' : v))

			case 'bigint':
				return feed('b' + v)

			case 'boolean':
				return feed(v ? 'T' : 'F')

			case 'undefined':
				return feed('U')

			case 'function':
				// compile replaces refine checks in place
				v = originalFunction(v)
				if (ids.has(v)) return feed('#' + ids.get(v))
				ids.set(v, ids.size)
				return feed(isAsyncFunction(v) ? 'fa' : 'fs')

			case 'symbol':
				unsupported = true
				return
		}

		if (v === null) return feed('N')
		if ('~standard' in v) return feed('S')

		if (visiting.has(v)) {
			unsupported = true
			return
		}

		// Elysia builders keep `~kind` on a shared prototype
		let kind: PropertyDescriptor | undefined
		const list = Array.isArray(v)
		const proto = Object.getPrototypeOf(v)
		if (
			list
				? proto !== Array.prototype
				: proto !== null && proto !== Object.prototype
		) {
			kind = proto && Object.getOwnPropertyDescriptor(proto, '~kind')

			if (
				!kind ||
				!('value' in kind) ||
				Reflect.ownKeys(proto).length !== 1 ||
				Object.getPrototypeOf(proto) !== Object.prototype
			) {
				unsupported = true
				return
			}
		}

		// the tag follows the bracket
		feed(list ? '[' : '{')
		if (kind) shape(kind.value)

		visiting.add(v)

		const map = at === 'response' && isResponseMap(v)
		const deferred = v['~kind'] === 'Deferred'

		for (const k of Reflect.ownKeys(v)) {
			const d = Object.getOwnPropertyDescriptor(v, k)!
			if (typeof k === 'symbol' || !('value' in d)) {
				unsupported = true
				break
			}

			const value = d.value
			if (k === '$ref' && typeof value === 'string') addRef(value, at)
			feed(d.enumerable ? ',' : ',!')
			quote(k)
			feed(':')

			if (map) named(value)
			else if (k === 'config' && isCookieAt(at))
				shape([value?.sign, !!value?.secrets])
			// secret never enters shape
			else if (
				k === 'secrets' &&
				(typeof value === 'string' || Array.isArray(value))
			)
				shape(!!value)
			else shape(value, childAt(at, k as string, value, deferred))
		}

		visiting.delete(v)

		feed(list ? ']' : '}')
	}

	// a string is a model name
	const named = (v: unknown, at?: string) => {
		if (typeof v === 'string') addRef(v, at)
		shape(v, at)
	}

	if (typeof handler === 'function' || handler == null) shape(handler)
	else
		feed(
			handler instanceof Response
				? 'R'
				: handler instanceof Promise
					? 'P'
					: typeof handler === 'object'
						? 'O'
						: 'V'
		)

	for (const event of shapeEvents) {
		feed('|')

		const fns = (hook as any)?.[event]
		if (fns) for (const fn of Array.isArray(fns) ? fns : [fns]) shape(fn)
	}

	const bf = hook?.beforeHandle as Function | Function[] | undefined
	feed(
		'|' +
			JSON.stringify(
				bf &&
					deriveModes(
						Array.isArray(bf) ? bf : [bf],
						(hook as any)['~deriveEntries']
					)
			)
	)

	for (const from of [hook, ...((hook as any)?.schemas || [])])
		for (const slot of shapeSlots) {
			feed('|')
			named(from?.[slot], slot)
		}

	// reference models, a cookie counts every schema a name may resolve to.
	// `refs` grows while walked: a model may name another
	let targets: ReturnType<typeof refTargets> | undefined
	for (const [ref, at] of refs)
		for (const target of at
			? (targets ??= refTargets([], models))(ref)
			: [models?.[ref]]) {
			feed('|')
			quote(ref)
			shape(target, at)
		}

	feed(
		'|' +
			JSON.stringify([
				config?.cookie?.sign,
				config?.cookie?.verify,
				config?.normalize,
				!!config?.allowUnsafeValidationDetails,
				config?.abortSignal !== false,
				isNotEmpty(frozenRoot['~ext']?.headers),
				// not `compact`: captured code works either way
				!!(config?.adapter ?? defaultAdapter).response
					.supportsDefaultHeaderSink,
				!!returnedErrorClasses(hook as any)
			])
	)
	shape(config?.sanitize)

	return unsupported ? undefined : hash
}

// module level: an arrow built inside `compileHandler` would keep its whole
// captured scope alive per route
const throwsOnCall = (error: unknown) => () => {
	throw error
}

const htmlBundleHandler = (method: string, path: string) => () => {
	throw new Error(
		`[Elysia] ${method} ${path} is an HTML bundle, only Bun's native router serves it`
	)
}

const isBareArrow = /^(?:async\s*)?\(\s*\)\s*=>/
const isSucroseOpaque = /arguments|eval|\[native code\]/

export function compileHandler(
	route: InternalRoute,
	root: AnyElysia,
	liveOnly: boolean = false
): CompiledHandler {
	let [
		method,
		path,
		handler,
		instance,
		localHook,
		appHook,
		inheritedChain,
		macroScope
	] = route

	const frozenRoot = frozenRootOf(root)
	const adapter = frozenRoot['~config']?.adapter ?? defaultAdapter

	const mountMeta =
		typeof handler === 'function' ? (handler as any)['~mount'] : undefined
	if (mountMeta) {
		const { handle, suffixLen } = mountMeta

		const rawRoot = suffixLen
			? path.slice(0, path.length - suffixLen)
			: path
		const encRoot = encodeURI(rawRoot)
		const rawLen = rawRoot.length
		const encLen = encRoot.length

		handler = (c: Context) =>
			handle(
				new Request(
					replaceUrlPath(
						c.request.url,
						c.path.slice(
							c.path.startsWith(encRoot) ? encLen : rawLen
						) || '/'
					),
					c.request
				)
			)
	}

	const reconstructed = liveOnly
		? undefined
		: Compiled.getHandler(frozenRoot['~programId'], method, path)
	// not captured: use none of the build's artifacts
	if (!reconstructed)
		liveOnly ||= Compiled.hasProgram(frozenRoot['~programId'])

	const hook = composeRouteHook(
		instance,
		localHook,
		appHook as any,
		inheritedChain as any,
		root,
		macroScope,
		!reconstructed
	)

	if (hook) {
		promoteDerive(hook)
		runIntrospect(hook)

		// before toArray: a bare `.parser()` name must end up as [fn]
		const namedParsers = frozenRoot['~ext']?.parser
		if (namedParsers && hook.parse) {
			const resolve = (p: any) =>
				typeof p === 'string' && p in namedParsers ? namedParsers[p] : p

			hook.parse = Array.isArray(hook.parse)
				? (hook.parse as any[]).map(resolve)
				: (resolve(hook.parse) as any)
		}

		toArray('parse', hook)
		toArray('transform', hook)
		toArray('beforeHandle', hook)
		toArray('afterHandle', hook)
		toArray('mapResponse', hook)
		toArray('afterResponse', hook)
		toArray('error', hook)
		toArray('handler', hook)
	}

	const buildValidator = () =>
		hook
			? Reconstruct.validator(hook as any, root, method, path, liveOnly)
			: undefined

	const errorClasses = returnedErrorClasses(hook as any)

	// A static instance of a registered class throws like a static Error. A
	// handler function never counts, even for a class like `Function`
	if (
		handler instanceof Error ||
		(typeof handler !== 'function' &&
			errorClasses?.some((C) => handler instanceof (C as any)))
	)
		handler = throwsOnCall(handler)
	else if (isHTMLBundle(handler)) handler = htmlBundleHandler(method, path)

	// macro `handler` wrappers, latest macro first: fold so it ends outermost
	const wrappers = hook?.handler as Function[] | undefined
	if (wrappers && typeof handler === 'function')
		for (let i = wrappers.length - 1; i >= 0; i--)
			handler = wrappers[i](handler)

	const declaresResponse =
		!!hook &&
		(hook.response != null ||
			!!(hook.schemas as { response?: unknown }[] | undefined)?.some(
				(schema) => schema?.response
			))

	const isHandleFunction = typeof handler === 'function'
	if (
		!isHandleFunction &&
		!(handler instanceof Promise) &&
		!(!targetsBun() && handler instanceof ElysiaFile) &&
		!declaresResponse
	) {
		const rootHeaders = frozenRoot['~ext']?.headers

		const set = {
			headers: rootHeaders
				? Object.assign(nullObject(), rootHeaders)
				: nullObject()
		}

		const response = adapter.response
		const mapped = mapStaticValue(response, response.map, set, handler)
		if (mapped) handler = mapped
	}

	const isStaticResponse = !isHandleFunction && handler instanceof Response
	const isPromiseHandler = !isHandleFunction && handler instanceof Promise

	let shape: number | undefined
	if (reconstructed || Capture.isCapturing()) {
		shape = routeShape(hook, handler, root)

		// drifted or unprovable: compile live
		if (reconstructed && (!shape || reconstructed.k !== shape)) {
			let live: CompiledHandler
			try {
				live = compileHandler(route, root, true)
			} catch (cause) {
				throw new Error(aotDriftMessage(method, path), { cause })
			}

			warnAotDrift(method, path)
			return live
		}
	}

	if (reconstructed)
		return reconstructed.f!(
			handler,
			...resolveHandlerParams(reconstructed.a!, {
				root,
				parse: adapter.parse as any,
				res: adapter.response as any,
				hook: (hook ?? nullObject()) as any,
				vali: reconstructed.a!.some(
					(name) => name === 'va' || isResponseParam(name)
				)
					? buildValidator()
					: undefined,
				cookieConfig: reconstructed.a!.includes('cc')
					? Reconstruct.cookie(hook, root)
					: undefined,
				tracers: reconstructed.a!.includes('tr')
					? Reconstruct.trace(hook, root)
					: undefined
			})
		) as CompiledHandler

	// Bare-route fast path.
	if (
		hook === undefined &&
		// a hook-less route still sees the app-level error classes
		!errorClasses &&
		isHandleFunction &&
		!mountMeta &&
		(method === 'GET' || method === 'HEAD') &&
		!root['~hasTrace'] &&
		!isNotEmpty(frozenRoot['~ext']?.headers) &&
		!Capture.isAotBuildEnv() &&
		!Capture.isCapturing()
	) {
		// A forged own `toString` makes sucrose widen every channel
		let isContextFree = false
		if (!Object.hasOwn(handler as Function, 'toString')) {
			const source = Function.prototype.toString.call(handler)
			isContextFree =
				isBareArrow.test(source) && !isSucroseOpaque.test(source)
		}

		if (isContextFree) {
			const compact = adapter.response.compact
			if (compact)
				return createInlineHandler(compact as any, handler as any)
		}
	}

	const state = describeRoute({
		method,
		handler,
		root,
		adapter,
		hook,
		buildValidator,
		isHandleFunction,
		isStaticResponse,
		isPromiseHandler
	})

	return compileHandlerJit({
		method,
		path,
		handler,
		root: frozenRoot as AnyElysia,
		errorRoot: root,
		hook,
		adapter,
		isHandleFunction,
		isStaticResponse,
		isPromiseHandler,
		errorClasses,
		state,
		shape
	})
}
