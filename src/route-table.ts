import { isDynamicRegex } from './constants'

import type { AnyElysia } from './base'
import type { AnyLocalHook, InternalRoute } from './types'
import type { ChainNode } from './utils'

export const RouteFlag = {
	WS: 1,
	Dynamic: 2
} as const

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
}

export interface RuntimeRouteTable {
	readonly length: number
	readonly method: readonly string[]
	readonly path: readonly string[]
	readonly flags: readonly number[]
}

export function buildRouteTable(
	declaredRoutes: readonly InternalRoute[]
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
		macroScope
	}
}

export const routeRow = (table: RouteTable, id: number) =>
	[
		table.method[id],
		table.path[id],
		table.handler[id],
		table.owner[id],
		table.localHook[id],
		table.appHook[id],
		table.inheritedChain[id],
		table.macroScope.get(id)
	] as unknown as InternalRoute

export const compactRouteTable = (table: RouteTable): RuntimeRouteTable =>
	Object.freeze({
		length: table.length,
		method: Object.freeze(table.method.slice()),
		path: Object.freeze(table.path.slice()),
		flags: Object.freeze(table.flags.slice())
	})
