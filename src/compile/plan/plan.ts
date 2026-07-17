import type { AnyElysia } from '../../base'
import type { ElysiaAdapter } from '../../adapter'

import { isAsyncFunction } from '../utils'

import type { RouteCompileState } from '../handler/descriptor'
import type { AnyLocalHook } from '../../types'

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

export interface PlanSegment {
	kind: SegmentKind

	link:
		| { via: 'handler' }
		| { via: 'validator'; slot: string }
		| { via: 'hook'; event: string; index: number }
		| { via: 'parse' }
		| { via: 'cookie-sign' }

	asyncClass: AsyncClass
	/**
	 * An abort check is emitted at the same effective site as the legacy lane.
	 * True when the legacy lane would place its `abortCheck` after this segment.
	 */
	cancellationSites: boolean
}

export interface RoutePlan {
	method: string
	path: string

	handlerKind: RouteCompileState['descriptor']['handlerKind']

	// context channel needs, read straight from the descriptor (never re-derived)
	needsQuery: boolean
	needsHeaders: boolean

	// response-mode facts
	hasSet: boolean
	responseMode: RouteCompileState['descriptor']['responseMode']

	tail: {
		hasAfterHandle: boolean
		hasMapResponse: boolean
		hasResponseValidator: boolean
		/** `true` when the covered afterResponse uses the sync `_fin` tee path. */
		syncAfterResponse: boolean
	}

	segments: PlanSegment[]

	supported: boolean
	unsupportedReasons: string[]
}

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
			link: { via: 'parse' },
			asyncClass: 'async',
			cancellationSites: d.hasLifecycleHook
		})

	const transforms = hookArray(hook?.transform)
	for (let i = 0; i < transforms.length; i++)
		main.push({
			kind: 'transform',
			link: { via: 'hook', event: 'transform', index: i },
			asyncClass: callableClass(transforms[i]),
			cancellationSites: false
		})

	if (transforms.length)
		main[main.length - 1]!.cancellationSites = d.hasLifecycleHook

	pushValidator(main, 'body', vali?.body, d.bodyValiIsAsync)
	pushValidator(main, 'headers', vali?.headers, d.headersValiIsAsync)
	pushValidator(main, 'params', vali?.params, d.paramsValiIsAsync)
	pushValidator(main, 'query', vali?.query, d.queryValiIsAsync)

	const beforeHandle = hookArray(hook?.beforeHandle)
	for (let i = 0; i < beforeHandle.length; i++) {
		main.push({
			kind: 'beforeHandle',
			link: { via: 'hook', event: 'beforeHandle', index: i },
			asyncClass: callableClass(beforeHandle[i]),
			cancellationSites: false
		})
	}

	if (beforeHandle.length)
		main[main.length - 1]!.cancellationSites = d.hasLifecycleHook

	main.push({
		kind: 'handler',
		link: { via: 'handler' },
		asyncClass: isHandleFunction
			? d.handlerIsAsync
				? 'async'
				: 'maybe'
			: d.handlerKind === 'promise'
				? 'async'
				: 'sync',
		cancellationSites: false
	})

	return {
		method: d.method,
		path: d.path,
		handlerKind: d.handlerKind,
		needsQuery,
		needsHeaders,
		hasSet,
		responseMode: d.responseMode,
		tail: {
			hasAfterHandle: d.hasAfterHandle,
			hasMapResponse: d.hasMapResponse,
			hasResponseValidator: d.hasResponseValidator,
			syncAfterResponse: d.syncAfterResponse
		},
		segments: main,
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
		link: { via: 'validator', slot },
		asyncClass: isAsync ? 'async' : 'sync',
		cancellationSites: false
	})
}

function callableClass(fn: unknown): AsyncClass {
	if (typeof fn !== 'function') return 'maybe'
	return isAsyncFunction(fn) ? 'async' : 'maybe'
}
