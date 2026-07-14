import type { AnyElysia } from '../../base'
import type { ElysiaAdapter } from '../../adapter'

import { isAsyncFunction } from '../utils'

import type { RouteCompileState } from '../handler/descriptor'
import type { AnyLocalHook } from '../../types'

export type Region = 'main' | 'error' | 'completion'
export type AsyncClass = 'sync' | 'async' | 'maybe'
export type SegmentKind =
	| 'parse'
	| 'transform'
	| `validate:${'body' | 'headers' | 'params' | 'query' | 'cookie'}`
	| 'validate:response'
	| 'beforeHandle'
	| 'handler'
	| 'afterHandle'
	| 'mapResponse'
	| 'cookie-sign'
	| 'error-hook'
	| 'afterResponse'

export interface CancellationSites {
	/**
	 * `compat` mode emits an abort check at the same effective site as the
	 * legacy lane. True when the legacy lane would place its `abortCheck` after
	 * this segment.
	 */
	compat: boolean

	/**
	 * `suspension` mode emits an abort check ONLY at post-await points. True when
	 * this segment can suspend (asyncClass !== 'sync') and control resumes after
	 * an await.
	 */
	suspension: boolean
}

export interface PlanSegment {
	kind: SegmentKind
	region: Region

	link:
		| { via: 'handler' }
		| { via: 'validator'; slot: string }
		| { via: 'hook'; event: string; index: number }
		| { via: 'parse' }
		| { via: 'cookie-sign' }

	asyncClass: AsyncClass
	mayShortCircuit: boolean
	touchesSet: boolean
	cancellationSites: CancellationSites
}

export interface RoutePlan {
	method: string
	path: string

	handlerKind: RouteCompileState['descriptor']['handlerKind']

	// context channel needs, read straight from the descriptor (never re-derived)
	needsQuery: boolean
	needsHeaders: boolean
	needsCookie: boolean
	hasBody: boolean

	// response-mode facts
	hasSet: boolean
	responseMode: RouteCompileState['descriptor']['responseMode']

	tail: {
		hasAfterHandle: boolean
		hasMapResponse: boolean
		hasResponseValidator: boolean
		/** afterResponse scheduling (sync-only in the covered set). */
		hasAfterResponse: boolean
		/** `true` when the covered afterResponse uses the sync `_fin` tee path. */
		syncAfterResponse: boolean
		/** cookie jar wiring (sync, unsigned in the covered set). */
		needsCookie: boolean
	}

	assimilation: 'promise'

	region: {
		main: PlanSegment[]
		error: PlanSegment[]
		completion: PlanSegment[]
	}

	supported: boolean
	unsupportedReasons: string[]
}

const noCancel = (): CancellationSites => ({ compat: false, suspension: false })

export const hookArray = (value: unknown): Function[] =>
	value ? (Array.isArray(value) ? value : [value as Function]) : []

export function planRoute(
	state: RouteCompileState,
	hook: AnyLocalHook | undefined,
	handler: unknown,
	_adapter: ElysiaAdapter,
	_root: AnyElysia,
	isHandleFunction: boolean
): RoutePlan {
	const { descriptor: d, vali, inference } = state

	const unsupportedReasons: string[] = []

	if (d.hasErrorHook) unsupportedReasons.push('errorHook')
	if (d.hasTrace) unsupportedReasons.push('trace')
	if (d.hasCookieSign) unsupportedReasons.push('cookieSign')
	if (d.hasAfterResponse && !d.syncAfterResponse)
		unsupportedReasons.push('afterResponse')
	if (state.beforeHandlePrefix) unsupportedReasons.push('beforeHandlePrefix')

	const needsQuery = inference.query || !!vali?.query
	const needsHeaders = inference.headers || !!vali?.headers

	const hasSet = d.responseMode !== 'compact'

	const main: PlanSegment[] = []

	if (d.hasBody)
		main.push({
			kind: 'parse',
			region: 'main',
			link: { via: 'parse' },
			asyncClass: 'async',
			mayShortCircuit: false,
			touchesSet: false,
			cancellationSites: {
				compat: d.hasLifecycleHook,
				suspension: true
			}
		})

	const transforms = hookArray(hook?.transform)
	for (let i = 0; i < transforms.length; i++)
		main.push({
			kind: 'transform',
			region: 'main',
			link: { via: 'hook', event: 'transform', index: i },
			asyncClass: callableClass(transforms[i]),
			mayShortCircuit: false,
			touchesSet: true,
			cancellationSites: noCancel()
		})

	if (transforms.length)
		main[main.length - 1]!.cancellationSites.compat = d.hasLifecycleHook

	pushValidator(main, 'body', vali?.body, d.bodyValiIsAsync)
	pushValidator(main, 'headers', vali?.headers, d.headersValiIsAsync)
	pushValidator(main, 'params', vali?.params, d.paramsValiIsAsync)
	pushValidator(main, 'query', vali?.query, d.queryValiIsAsync)

	const beforeHandle = hookArray(hook?.beforeHandle)
	for (let i = 0; i < beforeHandle.length; i++) {
		main.push({
			kind: 'beforeHandle',
			region: 'main',
			link: { via: 'hook', event: 'beforeHandle', index: i },
			asyncClass: callableClass(beforeHandle[i]),
			mayShortCircuit: true,
			touchesSet: true,
			cancellationSites: noCancel()
		})
	}

	if (beforeHandle.length)
		main[main.length - 1]!.cancellationSites.compat = d.hasLifecycleHook

	main.push({
		kind: 'handler',
		region: 'main',
		link: { via: 'handler' },
		asyncClass: isHandleFunction
			? d.handlerIsAsync
				? 'async'
				: 'maybe'
			: d.handlerKind === 'promise'
				? 'async'
				: 'sync',
		mayShortCircuit: false,
		touchesSet: false,
		cancellationSites: noCancel()
	})

	if (d.hasLifecycleHook)
		for (const seg of main)
			if (seg.asyncClass !== 'sync')
				seg.cancellationSites.suspension = true

	return {
		method: d.method,
		path: d.path,
		handlerKind: d.handlerKind,
		needsQuery,
		needsHeaders,
		needsCookie: d.needsCookie,
		hasBody: d.hasBody,
		hasSet,
		responseMode: d.responseMode,
		tail: {
			hasAfterHandle: d.hasAfterHandle,
			hasMapResponse: d.hasMapResponse,
			hasResponseValidator: d.hasResponseValidator,
			hasAfterResponse: d.hasAfterResponse,
			syncAfterResponse: d.syncAfterResponse,
			needsCookie: d.needsCookie
		},
		assimilation: 'promise',
		region: {
			main,
			error: [],
			completion: []
		},
		supported: unsupportedReasons.length === 0,
		unsupportedReasons
	}
}

function pushValidator(
	main: PlanSegment[],
	slot: string,
	vali: unknown,
	isAsync: boolean
) {
	if (!vali) return

	main.push({
		kind: `validate:${slot}` as SegmentKind,
		region: 'main',
		link: { via: 'validator', slot },
		asyncClass: isAsync ? 'async' : 'sync',
		mayShortCircuit: false,
		touchesSet: false,
		cancellationSites: noCancel()
	})
}

function callableClass(fn: unknown): AsyncClass {
	if (typeof fn !== 'function') return 'maybe'
	return isAsyncFunction(fn) ? 'async' : 'maybe'
}
