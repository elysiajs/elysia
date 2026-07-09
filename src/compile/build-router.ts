import Memoirist from 'memoirist'

import { composeRouteHook, localMacroRoot } from './handler'
import { isDynamicRegex, needEncodeRegex } from '../constants'
import {
	getLoosePath,
	isNotEmpty,
	nullObject,
	schemaProperties
} from '../utils'
import type { ChainNode } from '../utils'
import { isBun } from '../universal/constants'
import { buildWSRoute } from '../ws/route'

import type { AnyElysia, StaticMapAliases } from '../base'
import type { CompiledHandler, InternalRoute } from '../types'

// A distinctive string that only exists inside this extracted module
export const BUILD_ROUTER_MARKER = '__ELYSIA_BUILD_ROUTER_GRAPH__'

export interface BuildRouterDeps{
	history: InternalRoute[]
	handler(
		index: number,
		immediate: boolean | undefined,
		route: InternalRoute,
		precomputedStatic?: Response,
		aliases?: StaticMapAliases
	): CompiledHandler
	initMap(): void
	wrapHeadHandler(handler: CompiledHandler): CompiledHandler
}

interface RouterApp {
	'~config'?: {
		precompile?: boolean
		autoHead?: boolean
		strictPath?: boolean
		websocket?: unknown
	}
	'~map'?: {
		[method: string]: { [path: string]: CompiledHandler } | undefined
	}
	'~router'?: Memoirist<CompiledHandler>
	'~hasDynamicWS'?: boolean
	'~ext'?: { macro?: unknown; models?: Record<string, unknown> }
	'~scopeChildren'?: unknown
	'~hookChain'?: ChainNode
}

function slotHasString(h: Record<string, unknown> | undefined) {
	if (!h || typeof h !== 'object') return false

	for (const key of schemaProperties) {
		const v = h[key]
		if (typeof v === 'string') return true

		if (key === 'response' && v && typeof v === 'object') {
			const record = v as Record<string, unknown>
			if (
				'~kind' in record ||
				'~elyAcl' in record ||
				'~standard' in record
			)
				continue

			for (const status in record)
				if (typeof record[status] === 'string') return true
		}
	}

	return false
}

function hookHasString(h: Record<string, unknown> | undefined) {
	if (slotHasString(h)) return true

	const schemas = (h as { schemas?: unknown } | undefined)?.schemas
	if (Array.isArray(schemas))
		for (let s = 0; s < schemas.length; s++)
			if (
				slotHasString(schemas[s] as Record<string, unknown> | undefined)
			)
				return true

	return false
}

function chainHasModelRef(
	start: ChainNode | undefined,
	memo: WeakMap<ChainNode, boolean>
) {
	if (!start) return false

	const cached = memo.get(start)
	if (cached !== undefined) return cached

	let found = false
	const stack: (ChainNode | undefined)[] = [start]
	while (stack.length) {
		const node = stack.pop()
		if (!node) continue

		if ('combine' in node) {
			stack.push(node.combine)
			stack.push(node.over)
		} else {
			if (
				hookHasString(node.added as Record<string, unknown> | undefined)
			) {
				found = true
				break
			}

			stack.push(node.parent)
		}
	}

	memo.set(start, found)

	return found
}

function routeMayHaveModelRef(
	app: RouterApp,
	route: InternalRoute,
	memo: WeakMap<ChainNode, boolean>
): boolean {
	if (app['~ext']?.macro || app['~scopeChildren']) return true

	const localRoot = localMacroRoot(
		((route[7] as AnyElysia) ??
			(route[3] as AnyElysia) ??
			(app as unknown as AnyElysia)) as AnyElysia,
		app as unknown as AnyElysia
	) as unknown as { '~ext'?: { macro?: unknown } }
	if (localRoot['~ext']?.macro) return true

	// route[4]: localHook (per-route)
	if (hookHasString(route[4] as Record<string, unknown> | undefined))
		return true

	// Chain sources: route[5] (appHook), route[6] (inheritedChain)
	return (
		chainHasModelRef(route[5] as ChainNode | undefined, memo) ||
		chainHasModelRef(route[6] as ChainNode | undefined, memo) ||
		chainHasModelRef(app['~hookChain'], memo)
	)
}

function assertRouteModelRefs(
	app: RouterApp,
	route: InternalRoute,
	method: string
): void {
	const models = app['~ext']?.models
	const path = route[1]

	const checkSlots = (hook: Record<string, unknown> | undefined) => {
		if (!hook) return

		for (const key in hook) {
			if (!schemaProperties.has(key)) continue

			const v = hook[key]
			if (typeof v === 'string') {
				if (!models || !(v in models))
					throw new Error(
						`[Elysia] Unknown model reference "${v}" for ${key} on route ${method} ${path}.`
					)
			} else if (key === 'response' && v && typeof v === 'object') {
				const record = v as Record<string, unknown>
				if (
					'~kind' in record ||
					'~elyAcl' in record ||
					'~standard' in record
				)
					continue

				for (const status in record) {
					const r = record[status]
					if (typeof r === 'string' && (!models || !(r in models)))
						throw new Error(
							`[Elysia] Unknown model reference "${r}" for response ${status} on route ${method} ${path}.`
						)
				}
			}
		}
	}

	const hook = composeRouteHook(
		route[3] as AnyElysia,
		route[4] as any,
		route[5] as any,
		route[6] as any,
		app as unknown as AnyElysia,
		route[7] as AnyElysia | undefined
	) as (Record<string, unknown> & { schemas?: unknown[] }) | undefined

	checkSlots(hook)

	const schemas = hook?.schemas
	if (Array.isArray(schemas))
		for (let s = 0; s < schemas.length; s++) checkSlots(schemas[s] as any)
}

export function buildRouter(app: AnyElysia, deps: BuildRouterDeps): void {
	if ((BUILD_ROUTER_MARKER as unknown) === undefined) return

	const a = app as unknown as RouterApp
	const { history, handler, initMap, wrapHeadHandler } = deps

	const precompile = a['~config']?.precompile
	const enableAutoHead = a['~config']?.autoHead === true

	initMap()
	const methods = a['~map']!
	const length = history.length

	const isLoose = a['~config']?.strictPath !== true

	const modelRefMemo = new WeakMap<ChainNode, boolean>()

	let explicitHead: Set<string> | undefined
	let explicitPaths: Map<string, Set<string>> | undefined
	if (isLoose) explicitPaths = new Map()

	if (enableAutoHead || isLoose)
		for (let i = 0; i < length; i++) {
			const route = history[i]!
			const isWS = route[0] === 'WS'
			const m = route[0]
			const p = route[1]

			if (enableAutoHead && !isWS && m === 'HEAD')
				(explicitHead ??= new Set()).add(p)

			if (explicitPaths) {
				let set = explicitPaths.get(m)
				if (!set) explicitPaths.set(m, (set = new Set()))

				set.add(p)
				if (needEncodeRegex.test(p)) {
					const encoded = encodeURI(p)
					if (encoded !== p) set.add(encoded)
				}
			}
		}

	for (let i = 0; i < length; i++) {
		const route: InternalRoute = history[i]!
		const method = route[0]
		const path = route[1]

		if (routeMayHaveModelRef(a, route, modelRefMemo))
			assertRouteModelRefs(a, route, method)

		if ((route[0] as any) === 'WS') {
			const ws = buildWSRoute(route, app)
			const wsHandler = ws[0] as unknown as CompiledHandler
			const options = ws[1]

			if (isDynamicRegex.test(path)) {
				;(a['~router'] ??= new Memoirist<CompiledHandler>({
					loosePath: isLoose
				})).add('WS', path, wsHandler, false)

				a['~hasDynamicWS'] = true
			} else {
				initMap()
				const wsMap = (a['~map']!['WS'] ??= nullObject() as any)
				wsMap[path] = wsHandler

				if (isLoose) {
					const loose = getLoosePath(path)

					if (loose !== path && !explicitPaths?.get('WS')?.has(loose))
						wsMap[loose] = wsHandler
				}
			}

			if (options && isNotEmpty(options)) {
				a['~config'] ??= nullObject()
				const existing = (a['~config'] as any).websocket

				if (existing && isBun) {
					for (const key in options)
						if (
							key in existing &&
							(existing as any)[key] !== (options as any)[key]
						) {
							console.warn(
								`[Elysia] Conflicting per-route WebSocket option '${key}'\nBun uses one global WebSocket config per server, per-route values are not enforced (the last-registered route wins).`
							)
							console.warn(new Error().stack)
						}

					Object.assign(existing, options)
				} else (a['~config'] as any).websocket = options
			}

			continue
		}

		const autoHead =
			enableAutoHead && method === 'GET' && !explicitHead?.has(path)

		const isDynamic = isDynamicRegex.test(path)
		const needsEncode = needEncodeRegex.test(path)
		const registerLoose =
			!isDynamic &&
			isLoose &&
			(path.length === 0 || path.charCodeAt(path.length - 1) === 47)

		const explicitMain = registerLoose
			? explicitPaths?.get(method)
			: undefined

		if (!isDynamic && !needsEncode && !registerLoose) {
			const map = (methods[method] ??= nullObject() as any)

			const compiled = handler(
				i,
				precompile,
				route,
				undefined,
				autoHead ? { method, paths: [path], head: true } : undefined
			)

			map[path] = compiled

			if (autoHead) {
				const head = (methods['HEAD'] ??= nullObject() as any)
				head[path] = wrapHeadHandler(compiled)
			}

			continue
		}

		const variants = [path]
		if (needsEncode) {
			const encoded = encodeURI(path)
			if (encoded !== path) variants.push(encoded)
		}

		const paths: string[] = []
		for (let v = 0; v < variants.length; v++) {
			const p = variants[v]!
			paths.push(p)
			if (registerLoose) {
				const loose = getLoosePath(p)
				if (loose !== p && !explicitMain?.has(loose)) paths.push(loose)
			}
		}

		if (isDynamic) {
			const router = (a['~router'] ??= new Memoirist<CompiledHandler>({
				loosePath: isLoose
			}))

			const compiled = handler(i, precompile, route, undefined)

			const headHandler = autoHead ? wrapHeadHandler(compiled) : undefined

			for (let p = 0; p < paths.length; p++) {
				router.add(method, paths[p]!, compiled, false)
				if (headHandler)
					router.add('HEAD', paths[p]!, headHandler, false)
			}
		} else {
			const map = (methods[method] ??= nullObject() as any)

			const compiled = handler(i, precompile, route, undefined, {
				method,
				paths,
				head: autoHead
			})

			const headHandler = autoHead ? wrapHeadHandler(compiled) : undefined

			const head = autoHead
				? (methods['HEAD'] ??= nullObject() as any)
				: undefined

			for (let p = 0; p < paths.length; p++) {
				map[paths[p]!] = compiled
				if (headHandler) head![paths[p]!] = headHandler
			}
		}
	}
}
