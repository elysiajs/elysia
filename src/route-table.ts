import { needEncodeRegex } from './constants'

import type { AnyElysia } from './base'
import type { AnyLocalHook, InternalRoute } from './types'
import type { ChainNode } from './utils'

export const RouteFlag = {
	WS: 1,
	Dynamic: 2,
	Encode: 4
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
	/** any static route path is '' or ends with '/' (loose-alias candidate) */
	readonly hasLoose: boolean
	readonly macroScope?: Map<number, AnyElysia> // route[7]
}

export function buildRouteTable(
	declaredRoutes: readonly InternalRoute[]
): RouteTable {
	const length = declaredRoutes.length
	const method = new Array<string>(length)
	const path = new Array<string>(length)
	const handler = new Array<unknown>(length)
	const owner = new Array<AnyElysia>(length)
	const localHook = new Array<AnyLocalHook | undefined>(length)
	const appHook = new Array<ChainNode | undefined>(length)
	const inheritedChain = new Array<ChainNode | undefined>(length)
	const flags = new Array<number>(length)
	let hasLoose = false
	let macroScope: Map<number, AnyElysia> | undefined

	for (let i = 0; i < length; i++) {
		const route = declaredRoutes[i]
		const p = (path[i] = route[1])

		method[i] = route[0]
		handler[i] = route[2]
		owner[i] = route[3] as AnyElysia
		localHook[i] = route[4]
		appHook[i] = route[5]
		inheritedChain[i] = route[6]

		const isDynamic = p.indexOf(':') !== -1 || p.indexOf('*') !== -1

		flags[i] =
			(route[0] === 'WS' ? RouteFlag.WS : 0) |
			(isDynamic ? RouteFlag.Dynamic : 0) |
			(needEncodeRegex.test(p) ? RouteFlag.Encode : 0)

		if (
			!isDynamic &&
			(p.length === 0 || p.charCodeAt(p.length - 1) === 47)
		)
			hasLoose = true

		if (route[7])
			(macroScope ??= new Map<number, AnyElysia>()).set(
				i,
				route[7] as AnyElysia
			)
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
		hasLoose,
		macroScope
	}
}

export const routeRow = (table: RouteTable, id: number) => {
	return [
		table.method[id],
		table.path[id],
		table.handler[id],
		table.owner[id],
		table.localHook[id],
		table.appHook[id],
		table.inheritedChain[id],
		table.macroScope?.get(id)
	] as unknown as InternalRoute
}
