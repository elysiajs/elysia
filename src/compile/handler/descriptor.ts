import type { AnyElysia } from '../../base'
import type { ElysiaAdapter } from '../../adapter'
import { mergeInference, sucrose, type Sucrose } from '../../sucrose'

import type { RouteValidator } from '../../validator/route'
import type { Validator } from '../../validator'

import { isAsyncFunction, isAsyncLifecycle, mayReturnPromise } from '../utils'

import { compileCookieConfig } from '../../cookie/config'
import type { CompiledCookieConfig } from '../../cookie/config'
import { hasSyncHmac } from '../../cookie/utils'

import type { TraceEvent } from '../../trace'
import { Capture } from '../aot'
import {
	frozenRootOf,
	resolvedTraceOf,
	traceCapabilityRequired
} from '../../generation'
import { JITProbe } from '../jit-probe'

import { isNotEmpty, type CompactBeforeHandlePrefix } from '../../utils'
import type { AnyLocalHook, MaybeArray } from '../../types'

export interface RouteDescriptor {
	handlerKind: 'function' | 'response' | 'promise' | 'static-value'
	async: boolean
	responseMode:
		| 'compact'
		| 'default-headers'
		| 'set'
		| 'set-with-default-headers'

	// lifecycle presence
	hasBeforeHandle: boolean
	hasAfterHandle: boolean
	hasMapResponse: boolean
	hasAfterResponse: boolean
	hasErrorHook: boolean
	hasResponseValidator: boolean
	hasTrace: boolean
	traceCount: number
	hasLifecycleHook: boolean

	hasBody: boolean

	// per-slot validator asyncness
	bodyValiIsAsync: boolean
	headersValiIsAsync: boolean
	paramsValiIsAsync: boolean
	queryValiIsAsync: boolean
	cookieValiIsAsync: boolean
	responseValiAsync: boolean

	// cookie
	hasCookieSign: boolean
	syncCookieSign: boolean
	asyncCookieSign: boolean
	lazyCookieVerify: boolean

	// async + sync fast-path facts
	handlerIsAsync: boolean
	callHandlerSyncOnAsync: boolean
	syncErrorHook: boolean
	syncAfterResponse: boolean
}

// Non-serialisable artifacts the JIT still needs, bundled with the descriptor.
export interface RouteCompileState {
	descriptor: RouteDescriptor

	vali: RouteValidator<any> | undefined
	inference: Sucrose.Inference
	cookieConfig: CompiledCookieConfig | undefined

	beforeHandlePrefix: CompactBeforeHandlePrefix | undefined
	traceHandlers: Function[] | undefined
	tracePhases: ReadonlySet<TraceEvent> | null
	hasAnyPhase: boolean
	traceHandleOn: boolean
}

export interface DescribeRouteInput {
	method: string
	path: string
	handler: unknown
	root: AnyElysia
	adapter: ElysiaAdapter
	hook: AnyLocalHook | undefined
	buildValidator: () => RouteValidator<any> | undefined
	isHandleFunction: boolean
	isStaticResponse: boolean
	isPromiseHandler: boolean
}

/**
 * Route descriptors, keyed by root instance → `METHOD path` → descriptor
 * Populated on each JIT compile, and read only by tests and introspection
 */
export const routeDescriptors = new WeakMap<
	AnyElysia,
	Map<string, RouteDescriptor>
>()

// Read-only: consumers only call `.has` (`jit.ts` `phaseOn`, `descriptor.ts` `phaseOn`)
const noTracePhases: ReadonlySet<TraceEvent> = new Set<TraceEvent>()

const matchReturnIdentifier =
	// eslint-disable-next-line sonarjs/regex-complexity
	/(?:=>\s*|\breturn\s+)(?!(?:true|false|null|undefined|void|new|typeof|async|await|function|class)\b)[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*(?![\w$([])/

const mayReturnIdentifierCache = new WeakMap<Function, boolean>()

export function mayReturnIdentifier(fn: Function) {
	let result = mayReturnIdentifierCache.get(fn)
	if (result !== undefined) return result

	result = matchReturnIdentifier.test(fn.toString())
	mayReturnIdentifierCache.set(fn, result)

	return result
}

export const lifecycleMayReturnPromise = (
	handlers: MaybeArray<Function> | undefined,
	observed: boolean
) =>
	handlers
		? Array.isArray(handlers)
			? handlers.some(
					(fn) =>
						!isAsyncFunction(fn) &&
						(mayReturnPromise(fn) ||
							(observed && mayReturnIdentifier(fn)))
				)
			: !isAsyncFunction(handlers) &&
				(mayReturnPromise(handlers) ||
					(observed && mayReturnIdentifier(handlers)))
		: false

const compactPrefixInference = new WeakMap<
	CompactBeforeHandlePrefix,
	Sucrose.Inference
>()
const compactPrefixAsync = new WeakMap<CompactBeforeHandlePrefix, boolean>()

const inferCompactPrefix = (
	prefix: CompactBeforeHandlePrefix
): Sucrose.Inference => {
	const cached = compactPrefixInference.get(prefix)
	if (cached) return cached

	const pending: CompactBeforeHandlePrefix[] = []
	let current: CompactBeforeHandlePrefix | undefined = prefix
	let inference: Sucrose.Inference | undefined

	while (current) {
		inference = compactPrefixInference.get(current)
		if (inference) break

		pending.push(current)
		current = current.previous
	}

	for (let i = pending.length - 1; i >= 0; i--) {
		const item = pending[i]!
		const added = sucrose(undefined, {
			beforeHandle: item.added as any
		})
		inference = inference ? mergeInference(inference, added) : added
		compactPrefixInference.set(item, inference)
	}

	return inference!
}

function compactPrefixForcesAsync(prefix: CompactBeforeHandlePrefix) {
	const cached = compactPrefixAsync.get(prefix)
	if (cached !== undefined) return cached

	const pending: CompactBeforeHandlePrefix[] = []
	let current: CompactBeforeHandlePrefix | undefined = prefix
	let value = false

	while (current) {
		const previous = compactPrefixAsync.get(current)
		if (previous !== undefined) {
			value = previous
			break
		}

		pending.push(current)
		current = current.previous
	}

	for (let i = pending.length - 1; i >= 0; i--) {
		const item = pending[i]!
		for (let j = 0; !value && j < item.added.length; j++) {
			const fn = item.added[j]!
			value =
				isAsyncFunction(fn) ||
				(!isAsyncFunction(fn) &&
					(mayReturnPromise(fn) || mayReturnIdentifier(fn)))
		}
		compactPrefixAsync.set(item, value)
	}

	return value
}

const isAsyncValidator = (vali: Validator | undefined) =>
	(vali as Validator | undefined)?.isAsync ?? true

const mayReturnPromiseValidator = (vali: Validator | undefined) =>
	(vali as Validator | undefined)?.mayReturnPromise === true

/**
 * Extracted from `buildNativeStaticResponse`'s for-in check so the native
 * static promotion predicate
 */
export function isEmptyPipelineHook(hook: AnyLocalHook | undefined) {
	if (!hook) return true

	for (const key in hook) {
		if (key === 'detail' || key === 'tags') continue

		const value = (hook as any)[key]
		if (
			value !== undefined &&
			value !== false &&
			(!Array.isArray(value) || value.length)
		)
			return false
	}

	return true
}

export function describeRoute(input: DescribeRouteInput): RouteCompileState {
	const {
		method,
		handler,
		root,
		adapter,
		hook,
		buildValidator,
		isHandleFunction,
		isStaticResponse,
		isPromiseHandler
	} = input

	const vali = buildValidator()
	const beforeHandlePrefix = (hook as any)?.['~beforeHandlePrefix'] as
		| CompactBeforeHandlePrefix
		| undefined

	JITProbe.record('sucrose')
	let inference = sucrose(handler as any, hook as Sucrose.LifeCycle)
	if (beforeHandlePrefix)
		inference = mergeInference(
			inference,
			inferCompactPrefix(beforeHandlePrefix)
		)

	if (hook && typeof hook.parse === 'function')
		hook.parse = [hook.parse] as any

	const parseLength = Array.isArray(hook?.parse) ? hook.parse.length : 0
	const parseFirst = Array.isArray(hook?.parse) ? hook.parse[0] : hook?.parse
	const hasMergeBody = !!(hook as any)?.schemas?.some(
		(s: any) => s?.body
	)

	const bodylessMethod = method === 'GET' || method === 'HEAD'
	const hasBody =
		!!hook?.body ||
		hasMergeBody ||
		(!bodylessMethod &&
			(parseLength > 0 || inference.body) &&
			parseFirst !== 'none')

	const bodyValiIsAsync =
		hasBody &&
		(isAsyncValidator(vali?.body) || mayReturnPromiseValidator(vali?.body))

	const headersValiIsAsync =
		vali?.headers &&
		(isAsyncValidator(vali?.headers) ||
			mayReturnPromiseValidator(vali?.headers))

	const paramsValiIsAsync =
		vali?.params &&
		(isAsyncValidator(vali?.params) ||
			mayReturnPromiseValidator(vali?.params))

	const queryValiIsAsync =
		vali?.query &&
		(isAsyncValidator(vali?.query) ||
			mayReturnPromiseValidator(vali?.query))

	const cookieValidIsAsync =
		vali?.cookie &&
		(isAsyncValidator(vali?.cookie) ||
			mayReturnPromiseValidator(vali?.cookie))

	const appCookieConfig = frozenRootOf(root)['~config']?.cookie
	const needsCookie = !!vali?.cookie || !!inference.cookie
	const cookieConfig = needsCookie
		? compileCookieConfig(hook?.cookie as any, appCookieConfig as any)
		: undefined
	const hasCookieSign = !!cookieConfig?.hasSign

	const syncCookieSign =
		hasCookieSign && hasSyncHmac && !Capture.isCapturing()
	const asyncCookieSign = hasCookieSign && !syncCookieSign

	const lazyCookieVerify =
		syncCookieSign && cookieConfig?.verify === 'lazy' && !vali?.cookie

	const hasErrorHook = !!hook?.error?.length
	const hasStaticAfterResponse = !!hook?.afterResponse?.length
	const hasAfterResponse = hasStaticAfterResponse || !!inference.afterResponse
	const hasBeforeHandle =
		!!beforeHandlePrefix?.length || !!hook?.beforeHandle?.length
	const hasAfterHandle = !!hook?.afterHandle?.length
	const hasMapResponse = !!hook?.mapResponse?.length
	const hasResponseValidator = !!vali?.response
	const traceHandlers = (hook?.trace as any[] | undefined) ?? undefined
	const hasTrace = !!traceHandlers?.length
	const traceCount = hasTrace ? traceHandlers!.length : 0
	const hasLifecycleHook =
		parseLength > 0 ||
		!!hook?.transform?.length ||
		hasBeforeHandle ||
		hasAfterHandle ||
		hasMapResponse ||
		hasErrorHook ||
		hasAfterResponse

	const traceProvider = hasTrace ? resolvedTraceOf(root) : undefined
	if (hasTrace && !traceProvider) throw new Error(traceCapabilityRequired)

	const tracePhases = hasTrace
		? traceProvider!.unionTracePhases(traceHandlers as Function[])
		: noTracePhases

	const phaseOn = (phase: TraceEvent) =>
		hasTrace && (tracePhases === null || tracePhases.has(phase))

	const hasAnyPhase =
		hasTrace && (tracePhases === null || tracePhases.size > 0)

	const traceHandleOn = phaseOn('handle')

	let responseValiAsync = false
	if (vali?.response)
		for (const code in vali.response)
			if (
				isAsyncValidator(vali.response[code]) ||
				mayReturnPromiseValidator(vali.response[code])
			) {
				responseValiAsync = true
				break
			}

	const handlerIsAsync =
		isHandleFunction && isAsyncFunction(handler as Function)

	const errorHookForcesAsync =
		hasErrorHook &&
		(hasAfterHandle ||
			hasMapResponse ||
			hasResponseValidator ||
			isAsyncLifecycle(hook?.error) ||
			lifecycleMayReturnPromise(hook?.error, false))

	const afterResponseForcesAsync =
		(hasStaticAfterResponse && isAsyncLifecycle(hook?.afterResponse)) ||
		(hasAfterResponse &&
			(hasAfterHandle ||
				hasMapResponse ||
				hasResponseValidator ||
				hasErrorHook))

	const traceForcesAsync =
		(traceHandleOn || phaseOn('error') || phaseOn('afterResponse')) &&
		isHandleFunction &&
		!handlerIsAsync &&
		(mayReturnPromise(handler as Function) ||
			mayReturnIdentifier(handler as Function))

	const handlerResultObserved =
		isHandleFunction &&
		!handlerIsAsync &&
		(hasResponseValidator || hasAfterHandle || hasMapResponse) &&
		(mayReturnPromise(handler as Function) ||
			mayReturnIdentifier(handler as Function))

	const lifecycleForcesAsync =
		!!hook &&
		((beforeHandlePrefix
			? compactPrefixForcesAsync(beforeHandlePrefix)
			: false) ||
			lifecycleMayReturnPromise(hook.beforeHandle, true) ||
			lifecycleMayReturnPromise(hook.transform, false) ||
			lifecycleMayReturnPromise(hook.afterHandle, true) ||
			lifecycleMayReturnPromise(hook.mapResponse, true))

	const isAsync =
		hasBody ||
		handlerIsAsync ||
		errorHookForcesAsync ||
		traceForcesAsync ||
		afterResponseForcesAsync ||
		handlerResultObserved ||
		lifecycleForcesAsync ||
		asyncCookieSign ||
		responseValiAsync ||
		(hook &&
			(!!isAsyncLifecycle(hook?.afterHandle) ||
				!!isAsyncLifecycle(hook?.beforeHandle) ||
				!!isAsyncLifecycle(hook?.transform) ||
				!!isAsyncLifecycle(hook?.mapResponse) ||
				!!isAsyncLifecycle(hook?.error) ||
				bodyValiIsAsync ||
				headersValiIsAsync ||
				paramsValiIsAsync ||
				queryValiIsAsync ||
				cookieValidIsAsync))

	const callHandlerSyncOnAsync =
		isAsync && isHandleFunction && !handlerIsAsync

	const syncErrorHook = hasErrorHook && !isAsync && !hasTrace
	const syncAfterResponse =
		hasAfterResponse && !isAsync && !hasTrace && !hasErrorHook

	const handlerKind: RouteDescriptor['handlerKind'] = isHandleFunction
		? 'function'
		: isStaticResponse
			? 'response'
			: isPromiseHandler
				? 'promise'
				: 'static-value'

	const hasSetEffects =
		inference.cookie ||
		inference.set ||
		needsCookie ||
		hasAfterResponse ||
		hasErrorHook ||
		hasResponseValidator ||
		hasTrace
	const hasDefaultHeaders = isNotEmpty(frozenRootOf(root)['~ext']?.headers)
	const hasDefaultHeaderSink =
		hasDefaultHeaders && !!adapter.response.supportsDefaultHeaderSink
	const responseMode: RouteDescriptor['responseMode'] = hasDefaultHeaderSink
		? hasSetEffects
			? 'set-with-default-headers'
			: 'default-headers'
		: hasSetEffects || hasDefaultHeaders
			? 'set'
			: 'compact'

	const descriptor: RouteDescriptor = {
		handlerKind,
		async: !!isAsync,
		responseMode,

		hasBeforeHandle,
		hasAfterHandle,
		hasMapResponse,
		hasAfterResponse,
		hasErrorHook,
		hasResponseValidator,
		hasTrace,
		traceCount,
		hasLifecycleHook,

		hasBody,

		bodyValiIsAsync: !!bodyValiIsAsync,
		headersValiIsAsync: !!headersValiIsAsync,
		paramsValiIsAsync: !!paramsValiIsAsync,
		queryValiIsAsync: !!queryValiIsAsync,
		cookieValiIsAsync: !!cookieValidIsAsync,
		responseValiAsync,

		hasCookieSign,
		syncCookieSign,
		asyncCookieSign,
		lazyCookieVerify,

		handlerIsAsync,
		callHandlerSyncOnAsync: !!callHandlerSyncOnAsync,
		syncErrorHook,
		syncAfterResponse
	}

	return {
		descriptor,

		vali,
		inference,
		cookieConfig,

		beforeHandlePrefix,
		traceHandlers,
		tracePhases,
		hasAnyPhase,
		traceHandleOn
	}
}
