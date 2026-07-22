import type { AnyElysia } from '../../base'

import { defaultAdapter } from '../../adapter/constants'
import { contextDefaults } from '../../adapter/default-headers'
import { borrow } from '../../adapter/response-ownership'
import { ElysiaFile } from '../../universal/file'
import { isBun } from '../../universal/constants'

import { Capture, Compiled } from '../aot'
import { frozenRootOf } from '../../generation'
import { resolveHandlerParams } from './params'
import { compileHandlerJit } from './jit'
import { assertRouteProgram, bindRouteProgram } from './program'
export { setCaptureHeaderShorthand } from './jit'
import {
	clearRouteDescriptorAnalysisCaches,
	describeRoute,
	isEmptyPipelineHook,
	routeDescriptors
} from './descriptor'
import { Reconstrct } from './reconstruct'
import type { Context } from '../../context'
import type { RouteErrorFinalizer } from '../../handler/utils'
import {
	cloneHook,
	clearRootHookAnalysisCaches,
	compactBeforeHandleConflicts,
	compactBeforeHandlePrefix,
	eventProperties,
	flattenChain,
	flattenChainMemo,
	flattenChainMemoReadonly,
	fnOrigin,
	isCompactBeforeHandleOnly,
	isLocalScope,
	macroEpoch,
	mergeHook,
	nullObject,
	replaceUrlPath,
	type ChainNode
} from '../../utils'

import type {
	CompiledHandler,
	InternalRoute,
	AnyLocalHook,
	AppHook
} from '../../types'

interface MountHandlerMeta {
	handle: (request: Request) => unknown
	suffixLen: number
}

const markBorrowedResponse = (value: unknown) =>
	value instanceof Response ? borrow(value) : value

function resolveMountHandler(
	meta: MountHandlerMeta,
	path: string
): (c: Context) => unknown {
	const { handle, suffixLen } = meta

	const rawRoot = suffixLen ? path.slice(0, path.length - suffixLen) : path
	const encRoot = encodeURI(rawRoot)
	const rawLen = rawRoot.length
	const encLen = encRoot.length

	return (c: Context) => {
		const result = handle(
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
		return typeof (result as Promise<unknown>)?.then === 'function'
			? Promise.resolve(result).then(markBorrowedResponse)
			: markBorrowedResponse(result)
	}
}

function applyHook(
	localHook: Partial<AnyLocalHook> | undefined,
	appHook: Partial<AnyLocalHook> | undefined,
	rootHook: Partial<AppHook> | undefined,
	// `appHook` from `flattenChainMemo` is already a clone, safe to mutate
	// When no `localHook`, skip the redundant second clone
	appHookFresh = false
): AnyLocalHook | undefined {
	let hook: any

	if (localHook && appHook)
		hook = mergeHook(cloneHook(localHook) as any, appHook as any, true)
	else {
		const base = localHook ?? appHook
		const ownsBase = appHookFresh && !localHook && base !== undefined

		if (!rootHook)
			return ownsBase
				? (base as any)
				: base
					? cloneHook(base as any)
					: (base as any)

		hook = ownsBase ? base : base ? cloneHook(base as any) : nullObject()
	}

	if (rootHook) mergeHook(hook, rootHook as any, true, true)

	return hook
}

function collectHookOrigins(
	hook: Partial<AnyLocalHook> | undefined,
	into: Set<number>
): void {
	if (!hook) return

	for (const key in hook) {
		if (!eventProperties.has(key)) continue

		const v = (hook as any)[key]
		if (!v) continue

		if (Array.isArray(v))
			for (const fn of v) {
				const origin = fnOrigin.get(fn as Function)
				if (origin !== undefined) into.add(origin)
			}
		else {
			const origin = fnOrigin.get(v as Function)
			if (origin !== undefined) into.add(origin)
		}
	}
}

function dropHooksByOrigin(
	hook: Partial<AppHook>,
	skip: Set<number>
): Partial<AppHook> {
	let out = hook

	for (const key in hook) {
		if (!eventProperties.has(key)) continue

		const v = (hook as any)[key]
		if (!v) continue

		if (Array.isArray(v)) {
			let kept: Function[] | undefined

			for (let i = 0; i < v.length; i++) {
				const fn = v[i] as Function
				const origin = fnOrigin.get(fn)
				const keep = origin === undefined || !skip.has(origin)

				if (kept) {
					if (keep) kept.push(fn)
				} else if (!keep) {
					kept = v.slice(0, i) as Function[]
				}
			}

			if (kept) {
				if (out === hook) out = { ...hook }
				;(out as any)[key] = kept
			}
		} else {
			const origin = fnOrigin.get(v as Function)
			if (origin !== undefined && skip.has(origin)) {
				if (out === hook) out = { ...hook }
				;(out as any)[key] = []
			}
		}
	}

	return out
}

function reconstructNeedsHookState(names: string[]): boolean {
	for (let i = 0; i < names.length; i++)
		switch (names[i]) {
			case 'ph':
			case 'tf':
			case 'bf':
			case 'af':
			case 'mr':
			case 'er':
			case 'ar':
			case 'va':
			case 'cc':
			case 'tr':
				return true
		}

	return false
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
	if (!scopeMacro && !rootMacro) return hook

	let hasMacroKey = false
	for (const key in hook)
		if (
			(scopeMacro && key in scopeMacro) ||
			(rootMacro && key in rootMacro)
		) {
			hasMacroKey = true
			break
		}

	if (!hasMacroKey) return hook

	const perScope = memoScope(localHookMemos, root, scope)

	let resolved = perScope.get(hook)
	if (resolved === undefined) {
		resolved = cloneHook(hook)
		if (scopeMacro) {
			frozenRootOf(scope)['~applyMacro'](resolved)

			if (rootMacro)
				for (const k in resolved)
					if (k in scopeMacro) delete (resolved as any)[k]
		}

		if (rootMacro) frozenRoot['~applyMacro'](resolved)
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
	if (!resolved || (resolved as { derive?: unknown }).derive === undefined)
		return resolved

	const owned = cloneHook(resolved)
	promoteDerive(owned)

	return owned
}

// Memo of resolved chain-node `added`
//
// Chain node (a `.guard`/`.group`/`.on` entry, possibly carrying a macro key)
// is shared by reference across every app that reuses the plugin it lives in
const chainNodeMemos: ResolutionMemo = new WeakMap()

export function clearHandlerAnalysisCaches(root: AnyElysia) {
	localHookMemos.delete(root)
	chainNodeMemos.delete(root)
	clearRootHookAnalysisCaches(root)
	clearRouteDescriptorAnalysisCaches(root)
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

	let needsMacro = false
	if (scopeMacro || rootMacro)
		for (const key in added)
			if (
				(scopeMacro && key in scopeMacro) ||
				(rootMacro && key in rootMacro)
			) {
				needsMacro = true
				break
			}

	if (!needsMacro && (added as { derive?: unknown }).derive === undefined)
		return added

	const perScope = memoScope(chainNodeMemos, root, scope)

	let resolved = perScope.get(added)
	if (resolved === undefined) {
		resolved = cloneHook(added)
		if (needsMacro) {
			if (scopeMacro) {
				frozenRootOf(scope)['~applyMacro'](resolved)

				if (rootMacro)
					for (const k in resolved)
						if (k in scopeMacro) delete (resolved as any)[k]
			}

			if (rootMacro) frozenRoot['~applyMacro'](resolved)
		}

		promoteDerive(resolved)
		perScope.set(added, resolved)
	}

	return resolved
}

const chainResolver = (root: AnyElysia) => {
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

function composeRootHook(
	root: AnyElysia,
	inheritedChain: ChainNode | undefined
): Partial<AppHook> | undefined {
	const resolve = chainResolver(root)
	const locals = flattenChain(
		frozenRootOf(root)['~hookChain'],
		isLocalScope,
		inheritedChain,
		resolve
	)

	const inherited = locals
		? flattenChainMemo(root, inheritedChain, resolve)
		: flattenChainMemoReadonly(root, inheritedChain, resolve)

	if (!inherited) return locals
	if (!locals) return inherited

	return mergeHook(inherited, locals as any)
}

export function buildNativeStaticResponse(
	[
		,
		,
		handler,
		instance,
		localHook,
		appHook,
		inheritedChain,
		macroScope
	]: InternalRoute,
	root: AnyElysia
) {
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

	const flatAppHook = flattenChainMemo(
		root,
		appHook as ChainNode,
		chainResolver(root)
	)
	const rootHook =
		instance !== root
			? composeRootHook(root, inheritedChain as any)
			: undefined
	const hook = applyHook(ownedHook, flatAppHook as any, rootHook, true)

	if (hook && !isEmptyPipelineHook(hook as any)) return

	const rootHeaders = frozenRoot['~ext']?.headers
	if (handler instanceof Response && !rootHeaders) return handler

	const mapped = (adapter.response.map as Function)(handler, {
		headers: rootHeaders
			? Object.assign(nullObject(), rootHeaders)
			: nullObject()
	})

	if (mapped instanceof Response) {
		if (
			!mapped.headers.has('content-type') &&
			(typeof handler === 'string' ||
				typeof handler === 'number' ||
				typeof handler === 'boolean')
		)
			mapped.headers.set('content-type', 'text/plain;charset=utf-8')

		return mapped
	}
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
	macroScope?: AnyElysia
): AnyLocalHook | undefined {
	const resolve = chainResolver(root)
	localHook = resolveLocalHook(
		localMacroRoot(macroScope ?? instance, root),
		localHook,
		root
	)

	const flatAppHook = appHook
		? flattenChainMemo(root, appHook as ChainNode, resolve)
		: undefined

	let locals =
		instance !== root
			? flattenChain(
					frozenRootOf(root)['~hookChain'],
					isLocalScope,
					inheritedChain as any,
					resolve
				)
			: undefined
	const instanceLocal =
		instance !== root
			? flattenChain((instance as AnyElysia)['~hookChain'], isLocalScope)
			: undefined

	const compactPrefix =
		instance !== root &&
		!Capture.isCapturing() &&
		!Capture.isAotBuildEnv() &&
		resolve === undefined &&
		isCompactBeforeHandleOnly(localHook as any) &&
		isCompactBeforeHandleOnly(flatAppHook as any) &&
		isCompactBeforeHandleOnly(locals as any) &&
		!instanceLocal?.error
			? compactBeforeHandlePrefix(inheritedChain)
			: undefined

	const present = new Set<number>()
	collectHookOrigins(localHook, present)
	collectHookOrigins(flatAppHook as any, present)

	if (
		compactPrefix &&
		present.size === 0 &&
		!compactBeforeHandleConflicts(localHook as any) &&
		!compactBeforeHandleConflicts(flatAppHook as any) &&
		!compactBeforeHandleConflicts(locals as any)
	) {
		let hook = applyHook(localHook, flatAppHook as any, undefined, true)
		if (locals)
			hook = hook ? mergeHook(hook, locals, false, true) : (locals as any)

		hook ??= nullObject() as any
		if (compactPrefix.inference)
			(hook as any).inference = Object.assign(
				{},
				compactPrefix.inference,
				(hook as any).inference
			)
		;(hook as any)['~beforeHandlePrefix'] = compactPrefix
		return hook
	}

	// `inherited` is readonly
	let inherited =
		instance !== root
			? (flattenChainMemoReadonly(
					root,
					inheritedChain as any,
					resolve
				) as Partial<AppHook> | undefined)
			: undefined

	if ((inherited || locals) && (flatAppHook || localHook) && present.size) {
		if (inherited) inherited = dropHooksByOrigin(inherited, present)
		if (locals) locals = dropHooksByOrigin(locals, present)
	}

	let hook = applyHook(
		localHook,
		flatAppHook as any,
		inherited
			? (cloneHook(inherited as any) as Partial<AppHook>)
			: undefined,
		true
	)

	// Append after-use root hooks last, after the plugin's own hooks.
	if (locals) hook = hook ? mergeHook(hook, locals, false, true) : locals

	if (instance !== root) {
		const errors = instanceLocal?.error
		if (errors) {
			hook ??= nullObject() as any
			let existing = (hook as any).error

			if (existing) {
				if (!Array.isArray(existing))
					existing = (hook as any).error = [existing]

				if (Array.isArray(errors)) {
					for (const fn of errors)
						if (!existing.includes(fn)) existing.push(fn)
				} else if (!existing.includes(errors)) existing.push(errors)
			} else
				(hook as any).error = Array.isArray(errors)
					? errors.slice()
					: [errors]
		}
	}

	return hook
}

export function compileHandler(
	[
		_method,
		path,
		handler,
		instance,
		localHook,
		appHook,
		inheritedChain,
		macroScope
	]: InternalRoute,
	root: AnyElysia,
	precomputedStatic?: Response,
	finalizeError: RouteErrorFinalizer | undefined = root['~finalizeError']
): CompiledHandler {
	const frozenRoot = frozenRootOf(root)
	const adapter = frozenRoot['~config']?.adapter ?? defaultAdapter
	const method = _method

	const mountMeta =
		typeof handler === 'function' ? (handler as any)['~mount'] : undefined
	if (mountMeta) handler = resolveMountHandler(mountMeta, path)

	const reconstructed = Compiled.getHandler(
		frozenRoot['~programId'],
		method,
		path
	)
	if (reconstructed && 'p' in reconstructed)
		assertRouteProgram(reconstructed.p)

	if (
		reconstructed &&
		!precomputedStatic &&
		typeof handler === 'function' &&
		!frozenRoot['~ext']?.macro &&
		!frozenRootOf(localMacroRoot(macroScope ?? instance, root))['~ext']
			?.macro
	) {
		if ('p' in reconstructed)
			return bindRouteProgram(
				reconstructed.p,
				handler,
				adapter.response,
				contextDefaults(root).response
			)

		if (!reconstructNeedsHookState(reconstructed.a))
			return reconstructed.f(
				handler,
				...resolveHandlerParams(reconstructed.a, {
					root,
					finalizeError,
					parse: adapter.parse as any,
					res: adapter.response as any,
					hook: nullObject() as any,
					vali: undefined,
					cookieConfig: undefined,
					tracers: undefined
				})
			) as CompiledHandler
	}

	const hook = composeRouteHook(
		instance,
		localHook,
		appHook as any,
		inheritedChain as any,
		root,
		macroScope
	)

	if (hook) {
		promoteDerive(hook)

		toArray('parse', hook)
		toArray('transform', hook)
		toArray('beforeHandle', hook)
		toArray('afterHandle', hook)
		toArray('mapResponse', hook)
		toArray('afterResponse', hook)
		toArray('error', hook)
	}

	const buildValidator = () =>
		hook ? Reconstrct.validator(hook as any, root, method, path) : undefined

	if (handler instanceof Error) {
		const error = handler
		handler = () => {
			throw error
		}
	}

	const isHandleFunction = typeof handler === 'function'
	if (precomputedStatic) handler = precomputedStatic
	else if (
		!isHandleFunction &&
		!(handler instanceof Promise) &&
		!(!isBun && handler instanceof ElysiaFile)
	) {
		const rootHeaders = frozenRoot['~ext']?.headers

		const set = {
			headers: rootHeaders
				? Object.assign(nullObject(), rootHeaders)
				: nullObject()
		}

		const mapped = (adapter.response.map as Function)(handler, set)
		if (mapped instanceof Response) {
			if (
				!mapped.headers.has('content-type') &&
				(typeof handler === 'string' ||
					typeof handler === 'number' ||
					typeof handler === 'boolean')
			)
				mapped.headers.set('content-type', 'text/plain;charset=utf-8')

			handler = mapped
		}
	}

	const isStaticResponse = !isHandleFunction && handler instanceof Response
	const isPromiseHandler = !isHandleFunction && handler instanceof Promise

	const namedParsers = frozenRoot['~ext']?.parser
	if (namedParsers && hook?.parse) {
		const resolve = (p: any) =>
			typeof p === 'string' && p in namedParsers ? namedParsers[p] : p

		hook.parse = Array.isArray(hook.parse)
			? (hook.parse as any[]).map(resolve)
			: (resolve(hook.parse) as any)
	}

	if (reconstructed && !('p' in reconstructed)) {
		return reconstructed.f(
			handler,
			...resolveHandlerParams(reconstructed.a, {
				root,
				finalizeError,
				parse: adapter.parse as any,
				res: adapter.response as any,
				hook: (hook ?? nullObject()) as any,
				vali: reconstructed.a.includes('va')
					? buildValidator()
					: undefined,
				cookieConfig: reconstructed.a.includes('cc')
					? Reconstrct.cookie(hook, root)
					: undefined,
				tracers: reconstructed.a.includes('tr')
					? Reconstrct.trace(hook)
					: undefined
			})
		) as CompiledHandler
	}

	const state = describeRoute({
		method,
		path,
		handler,
		root,
		adapter,
		hook,
		buildValidator,
		isHandleFunction,
		isStaticResponse,
		isPromiseHandler
	})

	if (root['~introspect'] === true || root['~config']?.introspect === true) {
		let descriptors = routeDescriptors.get(root)
		if (!descriptors) {
			descriptors = new Map()
			routeDescriptors.set(root, descriptors)
		}

		descriptors.set(`${method} ${path}`, state.descriptor)
	}

	return compileHandlerJit({
		method,
		path,
		handler,
		root: frozenRoot as AnyElysia,
		finalizeError,
		hook,
		adapter,
		state
	})
}
