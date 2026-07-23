import Memoirist, {
	type Node as MemoiristNode,
	type ParamNode as MemoiristParamNode
} from 'memoirist'

import { isDynamicRegex, needEncodeRegex } from '../constants'
import type { RouteTable } from '../route-table'
import { getLoosePath, nullObject } from '../utils'

export type RouteResolutionTable = Pick<
	RouteTable,
	'length' | 'method' | 'path'
>

export type ResolvedStaticRoutes = Readonly<{
	[method: string]: Readonly<{ [path: string]: number }> | undefined
}>

export type ResolvedDynamicRouter = Readonly<
	Pick<Memoirist<number>, 'find' | 'loosePath' | 'onParam' | 'root'>
>

export interface RouteResolutionCoverage {
	readonly declaredHttpRoutes: number
	readonly winningHttpRoutes: number
	readonly shadowedHttpRoutes: number
	readonly declaredWSRoutes: number
	readonly winningWSRoutes: number
	readonly shadowedWSRoutes: number
}

export interface RouteResolution {
	/** Surviving declarations in original declaration order. */
	readonly declarationIds: readonly number[]
	readonly httpDeclarationIds: readonly number[]
	readonly wsDeclarationIds: readonly number[]
	/** Exact static aliases, including encoded and non-strict-path aliases. */
	readonly staticRoutes: ResolvedStaticRoutes
	/** Provisional dynamic leaves whose stores are declaration IDs. */
	readonly dynamicRouter: ResolvedDynamicRouter | undefined
	readonly coverage: RouteResolutionCoverage
}

const canRegisterLoose = (path: string, dynamic: boolean) =>
	!dynamic && (path.length === 0 || path.charCodeAt(path.length - 1) === 47)

const dynamicTokenRegex = /:[^/]+|\*$/g

/** Canonicalize request-visible literals while leaving Memoirist syntax intact. */
const canonicalRequestPath = (path: string, dynamic: boolean) => {
	if (!path) return '/'

	let candidate = path.charCodeAt(0) === 47 ? path : `/${path}`
	if (!dynamic) return new URL(`http://e.ly${candidate}`).pathname

	let marker = '__elysia_route_token_'
	while (candidate.includes(marker)) marker += '_'

	const tokens: string[] = []
	candidate = candidate.replace(dynamicTokenRegex, (token) => {
		const index = tokens.push(token) - 1
		return `${marker}${index}__`
	})

	let normalized = new URL(`http://e.ly${candidate}`).pathname
	for (let i = 0; i < tokens.length; i++)
		normalized = normalized.replace(`${marker}${i}__`, tokens[i]!)

	return normalized
}

const isReachableAlias = (path: string, dynamic: boolean) => {
	const registered =
		dynamic && path.charCodeAt(0) !== 47 ? `/${path}` : path
	return canonicalRequestPath(path, dynamic) === registered
}

const freezeNode = (node: MemoiristNode<number>): void => {
	if (node.inert)
		for (const key in node.inert) freezeNode(node.inert[key]!)

	const params = node.params as MemoiristParamNode<number> | null
	if (params?.inert) freezeNode(params.inert)
	if (params) {
		if (params.storeNames) Object.freeze(params.storeNames)
		Object.freeze(params)
	}

	if (node.inert) Object.freeze(node.inert)
	if (node.storeNames) Object.freeze(node.storeNames)
	if (node.wildcardStoreNames) Object.freeze(node.wildcardStoreNames)
	Object.freeze(node)
}

const freezeRouter = (router: Memoirist<number> | undefined) => {
	if (!router) return
	for (const method in router.root) freezeNode(router.root[method]!)
	Object.freeze(router.root)
	return Object.freeze(router)
}

const collectNodeStores = (
	node: MemoiristNode<number>,
	into: Set<number>,
	staticRoutes: Record<string, Record<string, number> | undefined>,
	method: string,
	prefix = '',
	strictPath = false
): void => {
	const path = prefix + node.part
	if (
		node.store !== null &&
		((node.storeNames?.length ?? 0) > 0 ||
			!hasStaticWinner(staticRoutes, method, path, strictPath))
	)
		into.add(node.store)
	if (node.wildcardStore !== null) into.add(node.wildcardStore)

	if (node.inert)
		for (const key in node.inert)
			collectNodeStores(
				node.inert[key]!,
				into,
				staticRoutes,
				method,
				path,
				strictPath
			)

	const params = node.params as MemoiristParamNode<number> | null
	if (!params) return
	if (params.store !== null) into.add(params.store)
	if (params.inert)
		collectNodeStores(
			params.inert,
			into,
			staticRoutes,
			method,
			path,
			strictPath
		)
}

const hasStaticWinner = (
	staticRoutes: Record<string, Record<string, number> | undefined>,
	method: string,
	path: string,
	strictPath: boolean
) => {
	const methodRoutes = staticRoutes[method]
	const wildcardRoutes = method === 'WS' ? undefined : staticRoutes['*']
	if (methodRoutes?.[path] !== undefined) return true
	if (method !== '*' && wildcardRoutes?.[path] !== undefined) return true

	if (
		strictPath ||
		path.length <= 1 ||
		path.charCodeAt(path.length - 1) !== 47
	)
		return false

	const loose = path.slice(0, -1)
	if (methodRoutes?.[loose] !== undefined) return true
	return method !== '*' && wildcardRoutes?.[loose] !== undefined
}

/**
 * Resolve the route leaves before route composition or validation.
 *
 * The registration rules deliberately mirror the public router build: HTTP
 * routes receive encoded/static aliases, Memoirist owns optional parameters,
 * and WebSocket routes keep their separate namespace and loose static alias.
 * URL canonicalization filters unreachable aliases; it never rewrites an
 * unreachable declaration into a different route.
 */
export function resolveRouteTable(
	table: RouteResolutionTable,
	strictPath = false
): RouteResolution {
	const length = table.length
	if (
		!Number.isSafeInteger(length) ||
		length < 0 ||
		table.method.length < length ||
		table.path.length < length
	)
		throw new Error('[ROUTE_RESOLUTION] invalid declaration table')

	const methods = new Array<string>(length)
	const dynamic = new Array<boolean>(length)
	let declaredHttpRoutes = 0
	let declaredWSRoutes = 0
	let hasLooseCandidate = false

	for (let i = 0; i < length; i++) {
		const rawMethod = table.method[i]
		const path = table.path[i]
		if (typeof rawMethod !== 'string' || !rawMethod || typeof path !== 'string')
			throw new Error(`[ROUTE_RESOLUTION] invalid declaration at ${i}`)

		const method = (methods[i] = rawMethod.toUpperCase())
		const isDynamic = (dynamic[i] = isDynamicRegex.test(path))
		if (method === 'WS') declaredWSRoutes++
		else declaredHttpRoutes++
		if (!strictPath && canRegisterLoose(path, isDynamic))
			hasLooseCandidate = true
	}

	let explicitPaths: Map<string, Set<string>> | undefined
	if (hasLooseCandidate) {
		explicitPaths = new Map()
		for (let i = 0; i < length; i++) {
			const method = methods[i]!
			const path = table.path[i]!
			const isDynamic = dynamic[i]!
			let paths = explicitPaths.get(method)
			if (!paths) explicitPaths.set(method, (paths = new Set()))
			if (isReachableAlias(path, isDynamic)) paths.add(path)
			if (needEncodeRegex.test(path)) {
				const encoded = encodeURI(path)
				if (encoded !== path && isReachableAlias(encoded, isDynamic))
					paths.add(encoded)
			}
		}
	}

	const staticRoutes: Record<string, Record<string, number> | undefined> =
		nullObject()
	let dynamicRouter: Memoirist<number> | undefined
	const router = () =>
		(dynamicRouter ??= new Memoirist<number>({ loosePath: !strictPath }))

	for (let i = 0; i < length; i++) {
		const method = methods[i]!
		const path = table.path[i]!
		const isDynamic = dynamic[i]!

		if (method === 'WS') {
			if (isDynamic) {
				if (isReachableAlias(path, true)) router().add(method, path, i)
			} else {
				const aliases: string[] = []
				if (isReachableAlias(path, false)) aliases.push(path)
				if (!strictPath) {
					const loose = getLoosePath(path)
					if (
						loose !== path &&
						isReachableAlias(loose, false) &&
						!explicitPaths?.get(method)?.has(loose)
					)
						aliases.push(loose)
				}
				if (aliases.length) {
					const routes = (staticRoutes[method] ??= nullObject())
					for (const alias of aliases) routes[alias] = i
				}
			}
			continue
		}

		const variants = [path]
		if (needEncodeRegex.test(path)) {
			const encoded = encodeURI(path)
			if (encoded !== path) variants.push(encoded)
		}

		const aliases: string[] = []
		const registerLoose = !strictPath && canRegisterLoose(path, isDynamic)
		const explicitMain = registerLoose ? explicitPaths?.get(method) : undefined
		for (const variant of variants) {
			if (isReachableAlias(variant, isDynamic)) aliases.push(variant)
			if (registerLoose) {
				const loose = getLoosePath(variant)
				if (
					loose !== variant &&
					isReachableAlias(loose, false) &&
					!explicitMain?.has(loose)
				)
					aliases.push(loose)
			}
		}

		if (isDynamic) {
			if (aliases.length) {
				const target = router()
				for (const alias of aliases) target.add(method, alias, i)
			}
		} else if (aliases.length) {
			const routes = (staticRoutes[method] ??= nullObject())
			for (const alias of aliases) routes[alias] = i
		}
	}

	const surviving = new Set<number>()
	for (const method in staticRoutes) {
		const routes = staticRoutes[method]!
		for (const path in routes) surviving.add(routes[path]!)
		Object.freeze(routes)
	}

	if (dynamicRouter)
		for (const method in dynamicRouter.root)
			collectNodeStores(
				dynamicRouter.root[method]!,
				surviving,
				staticRoutes,
				method,
				'',
				strictPath
			)

	const declarationIds: number[] = []
	const httpDeclarationIds: number[] = []
	const wsDeclarationIds: number[] = []
	for (let i = 0; i < length; i++)
		if (surviving.has(i)) {
			declarationIds.push(i)
			if (methods[i] === 'WS') wsDeclarationIds.push(i)
			else httpDeclarationIds.push(i)
		}

	const winningHttpRoutes = httpDeclarationIds.length
	const winningWSRoutes = wsDeclarationIds.length
	return Object.freeze({
		declarationIds: Object.freeze(declarationIds),
		httpDeclarationIds: Object.freeze(httpDeclarationIds),
		wsDeclarationIds: Object.freeze(wsDeclarationIds),
		staticRoutes: Object.freeze(staticRoutes),
		dynamicRouter: freezeRouter(dynamicRouter),
		coverage: Object.freeze({
			declaredHttpRoutes,
			winningHttpRoutes,
			shadowedHttpRoutes: declaredHttpRoutes - winningHttpRoutes,
			declaredWSRoutes,
			winningWSRoutes,
			shadowedWSRoutes: declaredWSRoutes - winningWSRoutes
		})
	})
}
