import type { AnyElysia } from '../../base'
import type { ElysiaAdapter } from '../../adapter'
import {
	D1_INFERENCE_IMPLEMENTATION,
	inferHeaderKeys,
	mergeInference,
	sucrose,
	type Sucrose
} from '../../sucrose'

import type { RouteValidator } from '../../validator/route'
import type { Validator } from '../../validator'

import { isAsyncFunction, isAsyncLifecycle, mayReturnPromise } from '../utils'

import { compileCookieConfig } from '../../cookie/config'
import type { CompiledCookieConfig } from '../../cookie/config'
import { hasSyncHmac } from '../../cookie/utils'

import { unionTracePhases, type TraceEvent } from '../../trace'
import { isDynamicRegex } from '../../constants'
import { ELYSIA_TYPES } from '../../type/constants'
import { Capture } from '../aot'
import { frozenRootOf } from '../../generation'
import { JITProbe } from '../jit-probe'

import { isNotEmpty, type CompactBeforeHandlePrefix } from '../../utils'
import type { AnyLocalHook, InferenceOverride, MaybeArray } from '../../types'
import {
	contextDefaults,
	type DefaultResponseState
} from '../../adapter/default-headers'

export const RouteEffect = {
	Query: 1,
	Headers: 1 << 1,
	Route: 1 << 2,
	SetHeaders: 1 << 3
} as const

export type HandlerKind = 'function' | 'response' | 'promise' | 'static-value'

export type ResponseMode =
	| 'compact'
	| 'default-headers'
	| 'set'
	| 'set-with-default-headers'

export interface BodyPlan {
	enabled: boolean
	mode: 'none' | 'builtin' | 'chain' | 'default'
	builtin: string | null
	parserCount: number
	custom: boolean
	fallback: boolean
	mediaKind: 0 | 1 | 2 | 3
	presence: 'none' | 'content-type' | 'framing'
}

export interface RouteDescriptor {
	method: string
	path: string

	handlerKind: HandlerKind
	isStaticResponse: boolean
	async: boolean
	bodyPlan: BodyPlan
	responseMode: ResponseMode
	contextMode: 'compact' | 'set'
	headerKeys: readonly string[] | null
	effectMask: number

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
	bodyParserHook: AnyLocalHook | undefined

	vali: RouteValidator<any> | undefined
	cookieConfig: CompiledCookieConfig | undefined

	beforeHandlePrefix: CompactBeforeHandlePrefix | undefined
	traceHandlers: Function[] | undefined
	tracePhases: Set<TraceEvent> | null
	hasAnyPhase: boolean
	traceHandleOn: boolean
	defaultResponseState: DefaultResponseState | undefined
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
 * Route descriptors, keyed by root instance → `METHOD path` → descriptor.
 * Populated on each JIT compile for tests, audit, and root-local freeze.
 */
export const routeDescriptors = new WeakMap<
	AnyElysia,
	Map<string, RouteDescriptor>
>()

const matchReturnIdentifier =
	// `=>` may be minified with no gap (`=>x`); `return` always needs a
	// separator or it fuses into a different identifier (`returnx`).
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

const compactPrefixInference: Record<
	Sucrose.Implementation,
	WeakMap<CompactBeforeHandlePrefix, Sucrose.Inference>
> = {
	oracle: new WeakMap(),
	candidate: new WeakMap()
}
const compactPrefixAsync = new WeakMap<CompactBeforeHandlePrefix, boolean>()

function inferCompactPrefix(
	prefix: CompactBeforeHandlePrefix,
	implementation: Sucrose.Implementation
): Sucrose.Inference {
	const cache = compactPrefixInference[implementation]
	const cached = cache.get(prefix)
	if (cached) return cached

	const pending: CompactBeforeHandlePrefix[] = []
	let current: CompactBeforeHandlePrefix | undefined = prefix
	let inference: Sucrose.Inference | undefined

	while (current) {
		inference = cache.get(current)
		if (inference) break

		pending.push(current)
		current = current.previous
	}

	for (let i = pending.length - 1; i >= 0; i--) {
		const item = pending[i]!
		const added = sucrose(
			undefined,
			{
				beforeHandle: item.added as any
			},
			implementation
		)
		inference = inference ? mergeInference(inference, added) : added
		cache.set(item, inference)
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

// 1 structured/form, 2 scalar, 3 file
function schemaMediaKind(schema: any): 0 | 1 | 2 | 3 {
	if (!schema || typeof schema !== 'object' || '~standard' in schema) return 0

	const elyType = schema['~elyTyp']
	if (elyType === ELYSIA_TYPES.File || elyType === ELYSIA_TYPES.Files)
		return 3
	if (elyType === ELYSIA_TYPES.Form) return 1

	const kind = schema['~kind']
	if (
		kind === 'Object' ||
		kind === 'Array' ||
		kind === 'FormData' ||
		schema.type === 'object' ||
		schema.type === 'array'
	)
		return 1
	if (kind === 'File') return 3

	if (
		kind === 'String' ||
		kind === 'Number' ||
		kind === 'Integer' ||
		kind === 'Boolean' ||
		kind === 'Null' ||
		kind === 'Undefined' ||
		kind === 'Literal' ||
		(schema.type !== undefined &&
			['string', 'number', 'integer', 'boolean', 'null'].includes(
				schema.type
			))
	)
		return 2

	const branches = schema.anyOf ?? schema.oneOf ?? schema.allOf
	if (!Array.isArray(branches) || !branches.length) return 0

	let result: 0 | 1 | 2 | 3 = 0
	for (let i = 0; i < branches.length; i++) {
		const branch = schemaMediaKind(branches[i])
		if (branch === 0 || (result !== 0 && result !== branch)) return 0
		result = branch
	}

	return result
}

function createBodyPlan(
	enabled: boolean,
	parse: AnyLocalHook['parse'],
	bodyVali: Validator | undefined
): BodyPlan {
	if (!enabled)
		return {
			enabled: false,
			mode: 'none',
			builtin: null,
			parserCount: 0,
			custom: false,
			fallback: false,
			mediaKind: 0,
			presence: 'none'
		}

	if (typeof parse === 'string')
		return {
			enabled: true,
			mode: 'builtin',
			builtin: parse,
			parserCount: 1,
			custom: false,
			fallback: false,
			mediaKind: 0,
			presence: 'none'
		}

	const parsers = Array.isArray(parse) ? parse : []
	if (parsers.length === 1 && typeof parsers[0] === 'string')
		return {
			enabled: true,
			mode: 'builtin',
			builtin: parsers[0],
			parserCount: 1,
			custom: false,
			fallback: false,
			mediaKind: 0,
			presence: 'none'
		}

	let custom = false
	let builtin = false
	for (let i = 0; i < parsers.length; i++)
		if (typeof parsers[i] === 'function') custom = true
		else builtin = true

	const fallback = !builtin
	return {
		enabled: true,
		mode: parsers.length ? 'chain' : 'default',
		builtin: null,
		parserCount: parsers.length,
		custom,
		fallback,
		mediaKind: custom ? 0 : schemaMediaKind((bodyVali as any)?.schema),
		presence: fallback ? (bodyVali ? 'content-type' : 'framing') : 'none'
	}
}

/**
 * Extracted from `buildNativeStaticResponse`'s for-in check so the native
 * static promotion predicate
 */
export function isEmptyPipelineHook(hook: AnyLocalHook | undefined) {
	if (!hook) return true

	for (const key in hook) {
		if (key === 'detail' || key === 'tags' || key === 'inference') continue

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

export function applyInferenceOverride(
	inference: Sucrose.Inference,
	override: InferenceOverride | undefined
): Sucrose.Inference {
	if (!override) return inference

	return {
		query:
			typeof override.query === 'boolean'
				? override.query
				: inference.query,
		headers:
			typeof override.headers === 'boolean'
				? override.headers
				: inference.headers,
		body:
			typeof override.body === 'boolean' ? override.body : inference.body,
		cookie:
			typeof override.cookie === 'boolean'
				? override.cookie
				: inference.cookie,
		set: typeof override.set === 'boolean' ? override.set : inference.set,
		route:
			typeof override.route === 'boolean'
				? override.route
				: inference.route
	}
}

export function describeRoute(input: DescribeRouteInput): RouteCompileState {
	const {
		method,
		path,
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
	const inferenceImplementation =
		frozenRootOf(root)['~config']?.experimental?.inference ??
		D1_INFERENCE_IMPLEMENTATION
	let inference = sucrose(
		handler as any,
		hook as Sucrose.LifeCycle,
		inferenceImplementation
	)
	if (beforeHandlePrefix)
		inference = mergeInference(
			inference,
			inferCompactPrefix(beforeHandlePrefix, inferenceImplementation)
		)

	inference = applyInferenceOverride(
		inference,
		frozenRootOf(root)['~config']?.inference
	)
	inference = applyInferenceOverride(inference, hook?.inference)
	inference = { ...inference }

	if (vali?.query) inference.query = true
	if (vali?.headers) inference.headers = true
	if (vali?.body) inference.body = true
	if (vali?.cookie) inference.cookie = true

	if (hook && typeof hook.parse === 'function')
		hook.parse = [hook.parse] as any

	const parseLength = Array.isArray(hook?.parse) ? hook.parse.length : 0
	const parseFirst = Array.isArray(hook?.parse) ? hook.parse[0] : hook?.parse
	const hasStandaloneBody = !!(hook as any)?.schemas?.some(
		(s: any) => s?.body
	)

	const bodylessMethod = method === 'GET' || method === 'HEAD'
	const hasBody =
		!!hook?.body ||
		hasStandaloneBody ||
		(!bodylessMethod &&
			(parseLength > 0 || inference.body) &&
			parseFirst !== 'none')
	const bodyPlan = createBodyPlan(hasBody, hook?.parse, vali?.body)

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
	const hasAfterResponse = !!hook?.afterResponse?.length
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

	const tracePhases = hasTrace
		? unionTracePhases(traceHandlers as Function[])
		: new Set<TraceEvent>()

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
		hasAfterResponse &&
		(isAsyncLifecycle(hook?.afterResponse) ||
			hasAfterHandle ||
			hasMapResponse ||
			hasResponseValidator ||
			hasErrorHook)

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

	const handlerKind: HandlerKind = isHandleFunction
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
	const responseMode: ResponseMode = hasDefaultHeaderSink
		? hasSetEffects
			? 'set-with-default-headers'
			: 'default-headers'
		: hasSetEffects || hasDefaultHeaders
			? 'set'
			: 'compact'
	const contextMode: RouteDescriptor['contextMode'] =
		responseMode === 'set' || responseMode === 'set-with-default-headers'
			? 'set'
			: 'compact'
	let headerKeys = vali?.headers
		? null
		: inference.headers
			? inferHeaderKeys(handler as any, hook as Sucrose.LifeCycle)
			: Object.freeze([])
	if (needsCookie && headerKeys !== null && !headerKeys.includes('cookie'))
		headerKeys = [...headerKeys, 'cookie']
	const effectMask =
		(inference.query ? RouteEffect.Query : 0) |
		(inference.headers ? RouteEffect.Headers : 0) |
		((inference.route || hasTrace) && isDynamicRegex.test(path)
			? RouteEffect.Route
			: 0) |
		(inference.set || hasTrace ? RouteEffect.SetHeaders : 0)

	const descriptor: RouteDescriptor = {
		method,
		path,
		handlerKind,
		isStaticResponse,
		async: !!isAsync,
		bodyPlan,
		responseMode,
		contextMode,
		headerKeys,
		effectMask,

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
		bodyParserHook: bodyPlan.mode === 'chain' ? hook : undefined,

		vali,
		cookieConfig,

		beforeHandlePrefix,
		traceHandlers,
		tracePhases,
		hasAnyPhase,
		traceHandleOn,
		defaultResponseState: hasDefaultHeaderSink
			? contextDefaults(root).response
			: undefined
	}
}
