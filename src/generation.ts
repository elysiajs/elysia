import type { AnyElysia } from './base'
import type { AotFingerprint, ProgramId } from './compile/aot'
import type { RouteTable } from './route-table'
import type { ChainNode } from './utils'
import type { TraceCapability } from './trace'
import type { WSCapability, WSOptions } from './ws/types'

export interface FrozenRootView {
	readonly '~config': AnyElysia['~config']
	readonly '~ext': AnyElysia['~ext']
	readonly '~hookChain': ChainNode | undefined
	readonly '~scopeChildren': AnyElysia[] | undefined
	readonly '~applyMacro': AnyElysia['~applyMacro']
	readonly '~programId': ProgramId
}

export interface Generation extends FrozenRootView {
	readonly abi: AotFingerprint
	readonly routeTable: RouteTable
	readonly introspect: boolean
	readonly '~wsConfig'?: WSOptions
}

interface GenerationHolder {
	'~generation'?: Generation
}

export function generationOf(root: object): Generation {
	const generation = (root as GenerationHolder)['~generation']
	if (generation === undefined)
		throw new Error(
			'[Elysia] generationOf() called before the app was sealed (publication happens on listen / first fetch / .compile()).'
		)

	return generation
}

export const frozenRootOf = (root: AnyElysia) =>
	(root as unknown as GenerationHolder)['~generation'] ?? root

export const resolvedTraceOf = (root: AnyElysia): TraceCapability | undefined =>
	frozenRootOf(root)['~ext']?.capability?.trace?.provider

export const traceCapabilityRequired =
	"[Elysia] .trace() requires the trace capability: import { trace } from 'elysia/trace' and .use(trace())"

export const resolvedWsOf = (
	root: AnyElysia
): { provider: WSCapability; config: WSOptions | undefined } | undefined => {
	const frozen = frozenRootOf(root)
	const provider = frozen['~ext']?.capability?.ws?.provider
	if (!provider) return undefined

	return { provider, config: frozen['~wsConfig'] }
}

export const wsCapabilityRequired =
	"[Elysia] .ws() requires the WebSocket capability: import { websocket } from 'elysia/websocket' and .use(websocket())"
