import type { AnyElysia } from '../../base'

import { defaultAdapter } from '../../adapter/constants'

import { Compiled } from '../aot'
import { resolveHandlerParams } from './params'
import { compileHandlerJit } from './jit'
export { setCaptureHeaderShorthand } from './jit'
import { Reconstrct } from './reconstruct'

import {
	cloneHook,
	eventProperties,
	flattenChain,
	flattenChainMemo,
	fnOrigin,
	isLocalScope,
	mapMethodBack,
	mergeHook,
	nullObject,
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
			case 'ho':
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
	}

	hook.derive = undefined
}

function resolveChainMacros(
	root: AnyElysia,
	node: ChainNode | undefined
): void {
	while (node) {
		if ('combine' in node) {
			resolveChainMacros(root, node.combine)
			node = node.over
			continue
		}

		if (node.added) {
			root['~applyMacro'](node.added)
			promoteDerive(node.added)
		}

		node = node.parent
	}
}

function composeRootHook(
	root: AnyElysia,
	inheritedChain: ChainNode | undefined
): Partial<AppHook> | undefined {
	const inherited = flattenChainMemo(root, inheritedChain)
	const locals = flattenChain(
		root['~hookChain'],
		isLocalScope,
		inheritedChain
	)

	if (!inherited) return locals
	if (!locals) return inherited

	return mergeHook(inherited, locals as any)
}

export function buildNativeStaticResponse(
	[, , handler, instance, localHook, appHook, inheritedChain]: InternalRoute,
	root: AnyElysia
): Response | Promise<Response> | undefined {
	if (typeof handler === 'function') return

	if (handler instanceof Error) return

	const adapter = root['~config']?.adapter ?? defaultAdapter

	if (localHook) root['~applyMacro'](localHook)
	resolveChainMacros(root, appHook)
	if (inheritedChain) resolveChainMacros(root, inheritedChain as ChainNode)

	const flatAppHook = flattenChainMemo(root, appHook as ChainNode)
	const rootHook =
		instance !== root
			? composeRootHook(root, inheritedChain as any)
			: undefined
	const hook = applyHook(localHook, flatAppHook as any, rootHook, true)

	const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v)

	if (
		has(hook?.parse) ||
		has(hook?.transform) ||
		has(hook?.beforeHandle) ||
		has(hook?.afterHandle) ||
		has(hook?.mapResponse) ||
		has(hook?.afterResponse) ||
		has(hook?.trace)
	)
		return

	if (
		hook?.body ||
		hook?.query ||
		hook?.params ||
		hook?.headers ||
		hook?.cookie ||
		(hook?.schemas as unknown[] | undefined)?.length
	)
		return

	const rootHeaders = root['~ext']?.headers
	const buildSet = () => ({
		headers: rootHeaders
			? Object.assign(nullObject(), rootHeaders)
			: nullObject()
	})

	if (handler instanceof Promise) {
		return handler.then((resolved) => {
			if (resolved instanceof Response && !rootHeaders) return resolved

			const mapped = (adapter.response.map as Function)(
				resolved,
				buildSet()
			)
			return mapped instanceof Response ? mapped : undefined
		}) as Promise<Response>
	}

	if (handler instanceof Response && !rootHeaders) return handler

	const mapped = (adapter.response.map as Function)(handler, buildSet())
	if (mapped instanceof Response) return mapped
	if (mapped instanceof Promise) return mapped as Promise<Response>
}

function toArray(name: string, hook: any) {
	if (typeof hook[name] === 'function') hook[name] = [hook[name]]
}

export function composeRouteHook(
	instance: AnyElysia,
	localHook: Partial<AnyLocalHook> | undefined,
	appHook: ChainNode | undefined,
	inheritedChain: ChainNode | undefined,
	root: AnyElysia
): AnyLocalHook | undefined {
	const flatAppHook = appHook
		? flattenChainMemo(root, appHook as ChainNode)
		: undefined

	let inherited =
		instance !== root
			? (flattenChainMemo(root, inheritedChain as any) as
					| Partial<AppHook>
					| undefined)
			: undefined
	let locals =
		instance !== root
			? flattenChain(
					root['~hookChain'],
					isLocalScope,
					inheritedChain as any
				)
			: undefined

	if ((inherited || locals) && (flatAppHook || localHook)) {
		const present = new Set<number>()

		collectHookOrigins(localHook, present)
		collectHookOrigins(flatAppHook as any, present)

		if (present.size) {
			if (inherited) inherited = dropHooksByOrigin(inherited, present)
			if (locals) locals = dropHooksByOrigin(locals, present)
		}
	}

	let hook = applyHook(localHook, flatAppHook as any, inherited, true)

	// Append after-use root hooks last, after the plugin's own hooks.
	if (locals) hook = hook ? mergeHook(hook, locals, false, true) : locals

	if (instance !== root) {
		const instanceLocal = flattenChain(
			(instance as AnyElysia)['~hookChain'],
			isLocalScope
		)

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
		inheritedChain
	]: InternalRoute,
	root: AnyElysia,
	precomputedStatic?: Response
): CompiledHandler {
	const adapter = root['~config']?.adapter ?? defaultAdapter
	const method = mapMethodBack(_method as any)
	const reconstructed = Compiled.handlers?.[method]?.[path]

	// When frozen factory does not consume any hook-derived params
	// Keep non-function/static/Error/precomputed/macro cases on the normal path
	// to preserve existing compile-time side-effect/order semantics
	if (
		reconstructed &&
		!precomputedStatic &&
		typeof handler === 'function' &&
		!root['~ext']?.macro &&
		!reconstructNeedsHookState(reconstructed.a)
	)
		return reconstructed.f(
			handler,
			...resolveHandlerParams(reconstructed.a, {
				parse: adapter.parse as any,
				res: adapter.response as any,
				hook: nullObject() as any,
				vali: undefined,
				cookieConfig: undefined,
				tracers: undefined
			})
		) as CompiledHandler

	if (root['~ext']?.macro) {
		if (localHook) root['~applyMacro'](localHook)
		if (appHook) resolveChainMacros(root, appHook)
		if (inheritedChain)
			resolveChainMacros(root, inheritedChain as ChainNode)
	}

	const hook = composeRouteHook(
		instance,
		localHook,
		appHook as any,
		inheritedChain as any,
		root
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
		hook
			? Reconstrct.validator(hook as any, root, method, path)
			: undefined

	if (handler instanceof Error) {
		const error = handler
		handler = () => {
			throw error
		}
	}

	const isHandleFunction = typeof handler === 'function'
	if (precomputedStatic) handler = precomputedStatic
	else if (!isHandleFunction && !(handler instanceof Promise)) {
		const rootHeaders = root['~ext']?.headers

		const set = {
			headers: rootHeaders
				? Object.assign(nullObject(), rootHeaders)
				: nullObject()
		}

		const mapped = (adapter.response.map as Function)(handler, set)
		if (mapped instanceof Response) handler = mapped
	}

	const isStaticResponse = !isHandleFunction && handler instanceof Response
	const isPromiseHandler = !isHandleFunction && handler instanceof Promise

	const namedParsers = root['~ext']?.parser
	if (namedParsers && hook?.parse) {
		const resolve = (p: any) =>
			typeof p === 'string' && p in namedParsers ? namedParsers[p] : p

		hook.parse = Array.isArray(hook.parse)
			? (hook.parse as any[]).map(resolve)
			: (resolve(hook.parse) as any)
	}

	if (reconstructed)
		return reconstructed.f(
			handler,
			...resolveHandlerParams(reconstructed.a, {
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

	return compileHandlerJit({
		method,
		path,
		handler,
		instance,
		root,
		hook,
		adapter,
		buildValidator,
		isHandleFunction,
		isStaticResponse,
		isPromiseHandler
	})
}
