import { isDynamicRegex } from './constants'

import type { AnyElysia } from './base'
import type { AnyLocalHook, InternalRoute } from './types'
import type { ChainNode } from './utils'

export const enum RouteFlag {
	WS = 1,
	Dynamic = 2,
	HasLocalHook = 4,
	HasMacroScope = 8
}

export interface RouteTable {
	readonly length: number
	readonly method: string[]
	readonly path: string[]
	readonly handler: unknown[]
	readonly owner: AnyElysia[]
	readonly localHook: (AnyLocalHook | undefined)[]
	readonly appHook: (ChainNode | undefined)[]
	readonly inheritedChain: (ChainNode | undefined)[]
	readonly flags: number[]
	readonly macroScope: Map<number, AnyElysia> // route[7]
	readonly source: Map<number, string> // mirrors `#routeSources`
}

export function buildRouteTable(
	declaredRoutes: readonly InternalRoute[],
	sources?: readonly (string | undefined)[]
): RouteTable {
	const length = declaredRoutes.length
	const method: string[] = []
	const path: string[] = []
	const handler: unknown[] = []
	const owner: AnyElysia[] = []
	const localHook: (AnyLocalHook | undefined)[] = []
	const appHook: (ChainNode | undefined)[] = []
	const inheritedChain: (ChainNode | undefined)[] = []
	const flags: number[] = []
	const macroScope = new Map<number, AnyElysia>()
	const source = new Map<number, string>()

	for (let i = 0; i < length; i++) {
		const route = declaredRoutes[i]
		const p = (path[i] = route[1])

		method[i] = route[0]
		handler[i] = route[2]
		owner[i] = route[3] as AnyElysia
		localHook[i] = route[4]
		appHook[i] = route[5]
		inheritedChain[i] = route[6]
		flags[i] =
			(route[0] === 'WS' ? RouteFlag.WS : 0) |
			(isDynamicRegex.test(p) ? RouteFlag.Dynamic : 0)

		if (route[7]) macroScope.set(i, route[7] as AnyElysia)

		const s = sources?.[i]
		if (s !== undefined) source.set(i, s)
	}

	return {
		length,
		method,
		path,
		handler,
		owner,
		localHook,
		appHook,
		inheritedChain,
		flags,
		macroScope,
		source
	}
}

export function routeRow(table: RouteTable, id: number): InternalRoute {
	return [
		table.method[id],
		table.path[id],
		table.handler[id],
		table.owner[id],
		table.localHook[id],
		table.appHook[id],
		table.inheritedChain[id],
		table.macroScope.get(id)
	] as unknown as InternalRoute
}
