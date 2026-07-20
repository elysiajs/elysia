import type { AnyElysia } from './base'
import type { AotFingerprint, ProgramId } from './compile/aot'
import type { RuntimeRouteTable } from './route-table'
import type { HistoryEntry, PublicRoute } from './types'
import type { ChainNode } from './utils'
import type { Server } from './universal/server'
import type { RouteErrorFinalizer } from './handler/utils'
import type { WebSocketHandler } from './ws/types'
import type { WSConnectionData } from './ws/context'
import type { AnySchema } from './type'

export interface RuntimeServerBinding {
	current?: Server
}

export interface RuntimeBindings {
	readonly server: RuntimeServerBinding
	readonly error: { current?: RouteErrorFinalizer }
	readonly finalizeError: RouteErrorFinalizer
}

export const createRuntimeBindings = (): RuntimeBindings => {
	const error: RuntimeBindings['error'] = {}

	return {
		server: {},
		error,
		finalizeError(context, cause) {
			if (!error.current) throw cause
			return error.current(context, cause)
		}
	}
}

export interface FrozenRootView {
	readonly '~config': AnyElysia['~config']
	readonly '~ext': AnyElysia['~ext']
	readonly '~hookChain': ChainNode | undefined
	readonly '~scopeChildren': AnyElysia[] | undefined
	readonly '~applyMacro': AnyElysia['~applyMacro']
	readonly '~programId': ProgramId
}

export interface RuntimeImage {
	readonly '~config': AnyElysia['~config']
	readonly '~ext': AnyElysia['~ext']
	readonly '~programId': ProgramId
	readonly server: RuntimeServerBinding
	readonly nativeStatic?: Record<string, Record<string, Response>>
	readonly websocket?: WebSocketHandler<WSConnectionData>
}

export interface IntrospectionImage {
	readonly routes: readonly PublicRoute[]
	readonly history: readonly HistoryEntry[]
	readonly models: Readonly<Record<string, AnySchema>>
	/** Compact route diagnostics; never retained by the strict runtime image. */
	readonly routeTable: RuntimeRouteTable
}

export interface Generation {
	readonly abi: AotFingerprint
	readonly runtime: RuntimeImage
	readonly introspect: boolean
	readonly introspection?: IntrospectionImage
}

interface GenerationHolder {
	'~generation'?: Generation
	'~routeTable'?: unknown
}

export const frozenRootOf = (root: AnyElysia): FrozenRootView => {
	const holder = root as unknown as GenerationHolder
	return ((holder['~routeTable'] === undefined
		? holder['~generation']?.runtime
		: undefined) ?? root) as FrozenRootView
}
