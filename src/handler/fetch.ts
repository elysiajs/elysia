import decodeComponent from 'deuri'

import { defaultAdapter } from '../adapter/constants'

import type { AnyElysia } from '../base'
import {
	hasAsync,
	emptyResponse,
	getNotFoundBody,
	getNotFound,
	drainDisposables
} from './utils'

import { createContext, type Context } from '../context'
import { origin } from '../adapter/origin'
import { createErrorHandler } from './error'
import {
	requestId,
	flattenChain,
	nullObject,
	isNotEmpty,
	authorityEnd
} from '../utils'
import { handleSet, materializeSetHeaders } from '../adapter/utils'
import {
	InternalServerError,
	NotFound,
	PROBLEM_JSON,
	internalServerErrorResponse,
	isProduction
} from '../error'

import type { AppHook, CompiledHandler, MaybePromise } from '../types'

function extractPath(url: string, context: any) {
	const s = url.indexOf('/', authorityEnd(url))
	const q = (context.qi = url.indexOf('?', s))

	return (context.path = q === -1 ? url.slice(s) : url.substring(s, q))
}

// Default 404 that still emits `Elysia.headers` defaults / hook-set headers + cookies.
function notFound(context: Context): Response {
	const set = context.set

	if (set.cookie || isNotEmpty(set.headers)) {
		handleSet(set)

		if (!(set.headers as any)['content-type'])
			(materializeSetHeaders(set) as any)['content-type'] = PROBLEM_JSON

		return new Response(getNotFoundBody(), {
			status: 404,
			headers: set.headers as any
		})
	}

	return getNotFound()
}

function decodeParams(params: Record<string, string>) {
	for (const key in params) {
		const value = params[key]
		if (value.indexOf('%') !== -1)
			params[key] = decodeComponent(value) ?? value
	}

	return params
}

// Warn once per app, even when its fetch handler is rebuilt.
const warnedPathMutation = new WeakSet<AnyElysia>()

function warnPathMutation(app: AnyElysia) {
	if (warnedPathMutation.has(app)) return
	warnedPathMutation.add(app)

	console.warn(
		'[elysia] context.path is readonly; request-hook rerouting will stop working in a future release.'
	)
}

function finalizeError(
	context: Context,
	handleError: (
		context: Context,
		error: Error,
		sign?: (set: Context['set']) => unknown
	) => unknown,
	afterResponse: ((context: Context, status?: number) => void) | undefined,
	error: Error,
	sign?: (set: Context['set']) => unknown
) {
	let resp: Response | Promise<Response>
	try {
		resp = handleError(context, error, sign) as Response | Promise<Response>
	} catch (errorPipelineThrow) {
		if (!isProduction()) console.error(errorPipelineThrow)
		resp = internalServerErrorResponse(error)
	}

	if (resp instanceof Promise)
		return resp.then(
			(r) => {
				afterResponse?.(context)
				return r
			},
			(errorPipelineThrow) => {
				if (!isProduction()) console.error(errorPipelineThrow)
				const r = internalServerErrorResponse(error)
				afterResponse?.(context)
				return r
			}
		)

	afterResponse?.(context)

	return resp
}

const catchError =
	(
		context: Context,
		handleError: (context: Context, error: Error) => unknown,
		afterResponse: ((context: Context, status?: number) => void) | undefined
	) =>
	(error: Error) =>
		finalizeError(context, handleError, afterResponse, error)

function dispatchResult(
	result: unknown,
	context: Context,
	handleError: (context: Context, error: Error) => unknown,
	afterResponse: ((context: Context, status?: number) => void) | undefined
): MaybePromise<Response> {
	if (result instanceof Promise)
		return result.catch(
			catchError(context, handleError, afterResponse)
		) as Promise<Response>

	if (typeof (result as any)?.then === 'function')
		return Promise.resolve(result).catch(
			catchError(context, handleError, afterResponse)
		) as Promise<Response>

	return result as Response
}

function findRoute(
	context: Context,
	request: Request,
	map: NonNullable<AnyElysia['~map']>,
	router: NonNullable<AnyElysia['~router']>,
	// a 404 isn't a route: the app's whole current chain answers it
	onNotFound: (context: Context) => MaybePromise<Response>,
	// a matched route's own lane, see `failRoute`
	handleError: (context: Context, error: Error) => unknown,
	afterResponse: ((context: Context, status?: number) => void) | undefined,
	strictPath: boolean,
	hasWS: boolean | undefined,
	hasDynamicWS: boolean | undefined,
	app: AnyElysia
) {
	const path = context.path
	const method = request.method

	// `map['WS']` is read before `method` is compared: without WS routes JSC
	// compiles this never-taken branch to a bare exit, see `methodMap` below
	if (hasWS) {
		const wsMap = map['WS']

		if (method === 'GET') {
			// '/' by id, see `methodMap` below
			const handler =
				path.length === 1 && path === '/' ? wsMap?.['/'] : wsMap?.[path]
			const found =
				handler === undefined && hasDynamicWS
					? router?.find('WS', path)
					: undefined

			if (handler !== undefined || found) {
				const upgrade = request.headers.get('upgrade')
				if (upgrade && upgrade.toLowerCase() === 'websocket') {
					if (handler)
						return dispatchResult(
							handler(context),
							context,
							handleError,
							afterResponse
						)

					context.params =
						path.indexOf('%') === -1
							? found!.params
							: decodeParams(found!.params)

					return dispatchResult(
						(found!.store as CompiledHandler)(context),
						context,
						handleError,
						afterResponse
					)
				}
			}
		}
	}

	const methodMap = map[method]
	let handler: CompiledHandler | number | undefined

	// wait until next version of Bun update WebKit
	// @see https://bugs.webkit.org/show_bug.cgi?id=323839
	if (path.length > 1) {
		handler = methodMap?.[path]

		if (!handler) {
			if (!strictPath && path.charCodeAt(path.length - 1) === 47) {
				const loose = path.slice(0, -1)
				// `//` leaves '/': a 1-char `loose` gets its own site too
				handler =
					loose.length > 1 ? methodMap?.[loose] : methodMap?.[path[0]]

				if (!handler) {
					const anyMap = map['*']
					handler = anyMap?.[path] ?? anyMap?.[loose]
				}
			} else handler = map['*']?.[path]
		}
	} else handler = methodMap?.[context.path] || map['*']?.[path]

	if (handler)
		return dispatchResult(
			// a number is a lazy route's encoded index, see `~map`
			typeof handler === 'number'
				? app['~dispatch'](~handler, context)
				: handler(context),
			context,
			handleError,
			afterResponse
		)

	const found = router?.find(method, path) ?? router?.find('*', path)

	if (found) {
		context.params =
			path.indexOf('%') === -1 ? found.params : decodeParams(found.params)

		const store = found.store
		const dynamic = typeof store === 'number' ? undefined : store

		return dispatchResult(
			dynamic
				? dynamic(context)
				: app['~dispatch'](store as number, context),
			context,
			handleError,
			afterResponse
		)
	}

	return onNotFound(context)
}

export function createFetchHandler(
	app: AnyElysia
): (request: Request) => MaybePromise<Response> {
	const Context = createContext(app)
	const map = app['~map']! ?? nullObject()
	const router = app['~router']!
	const hasWS = !!app['~hasWS']
	const hasDynamicWS = hasWS && !!app['~hasDynamicWS']
	const strictPath = !!app['~config']?.strictPath

	const hook = flattenChain(app['~hookChain'])
	// read once: a closure capturing `hook` keeps the whole root chain alive
	const errorHooks = hook?.error
	const requestHooks = hook?.request
	const afterResponseHooks = hook?.afterResponse
	const mapResponseHooks = hook?.mapResponse as
		| ((context: Context) => unknown)[]
		| undefined
	const traceHandlers = hook?.trace as
		| ((context: any) => unknown)[]
		| undefined
	const hasError = !!errorHooks

	const abortSignal = app['~config']?.abortSignal !== false
	const watchPath = !isProduction()

	/**
	 * Arm `context['~sig']` unless this request is provably the untouched
	 * `Request` the Bun adapter received, in which case materializing
	 * `request.signal` is deferred to the first suspension
	 * @see `../adapter/origin`
	 *
	 * Anything without provenance, `app.handle`, every non-Bun adapter, or a
	 * `.wrap()` HOC that substituted or delayed the request, falls back to
	 * today's eager behaviour
	 */
	const armEager = (request: Request, context: Context) => {
		if (!abortSignal || request === origin.request) return false

		return ((context as any)['~sig'] = request.signal).aborted
	}

	/**
	 * Peek after each callback. The actual await branch arms deferred requests;
	 * immediate callbacks must not materialize a signal just for this check.
	 */
	const armedAbort = (context: Context) =>
		abortSignal && (context as any)['~sig']?.aborted === true

	const baseMapResponse = (app['~config']?.adapter ?? defaultAdapter).response
		.map as (
		response: unknown,
		set: Context['set'],
		request?: Request,
		owned?: boolean
	) => unknown

	function finalMap(
		response: unknown,
		set: Context['set'],
		request: Request | undefined,
		sign: ((set: Context['set']) => unknown) | undefined
	) {
		if (!sign) return baseMapResponse(response, set, request, true)

		let pending: any
		try {
			pending = sign(set)
		} catch {}

		return pending
			? pending.then(
					() => baseMapResponse(response, set, request, true),
					() => baseMapResponse(response, set, request, true)
				)
			: baseMapResponse(response, set, request, true)
	}

	const plainMap = (
		response: unknown,
		set: Context['set'],
		context?: Context,
		sign?: (set: Context['set']) => unknown
	) =>
		finalMap(
			response,
			set,
			(context as { request?: Request } | undefined)?.request,
			sign
		)

	function mapWithHooks(
		mapResponseHooks: ((context: Context) => unknown)[],
		response: unknown,
		set: Context['set'],
		context?: Context,
		sign?: (set: Context['set']) => unknown
	) {
		if (!context) return baseMapResponse(response, set, undefined, true)
		;(context as { responseValue?: unknown }).responseValue = response

		const request = context.request

		const run = (i: number): unknown => {
			for (; i < mapResponseHooks.length; i++) {
				const result = mapResponseHooks[i](context)

				if (typeof (result as any)?.then === 'function')
					// eslint-disable-next-line sonarjs/function-inside-loop -- promise continuation for the hook at index i
					return Promise.resolve(result).then((resolved) => {
						if (resolved !== undefined)
							return finalMap(resolved, set, request, sign)

						return run(i + 1)
					})

				if (result !== undefined)
					return finalMap(result, set, request, sign)
			}

			return finalMap(response, set, request, sign)
		}

		return run(0)
	}

	const mapResponse = mapResponseHooks?.length
		? mapWithHooks.bind(null, mapResponseHooks)
		: plainMap

	const allowUnsafe = app['~config']?.allowUnsafeValidationDetails
	const handleError = createErrorHandler(
		errorHooks,
		mapResponse as any,
		allowUnsafe
	)

	const handleRouteError =
		errorHooks || mapResponseHooks?.length
			? createErrorHandler(undefined, plainMap as any, allowUnsafe)
			: handleError

	const hasTrace = !!traceHandlers?.length

	const traceProvider = hasTrace
		? app['~resolvedCapability']('trace')!
		: undefined

	const tracePhases = hasTrace
		? traceProvider!.unionTracePhases(
				traceHandlers as unknown as Function[]
			)
		: null

	const traceRequestPhase =
		hasTrace && (tracePhases === null || tracePhases.has('request'))

	const traceAfterResponsePhase =
		hasTrace && (tracePhases === null || tracePhases.has('afterResponse'))

	const tracerFactories = hasTrace
		? traceHandlers!.map((fn) => traceProvider!.createTracer(fn as any))
		: undefined

	const afterResponse = (
		context: Context,
		status?: number,
		// `null` on a matched route's lane: its own are compiled into it
		afterResponses:
			| AppHook['afterResponse']
			| null
			| undefined = afterResponseHooks
	) => {
		if ((context as any)._arf) return

		const queue = (context as any)['~afterResponse'] as
			| ((context: Context) => unknown)[]
			| undefined
		if (
			!afterResponses?.length &&
			!traceAfterResponsePhase &&
			!queue?.length &&
			!(context as any)['~dispose']
		)
			return
		;(context as any)._arf = true
		if (status !== undefined) context.set.status = status

		queueMicrotask(async () => {
			if (afterResponses?.length || queue?.length)
				materializeSetHeaders(context.set)

			// Bracket the hooks like the compiled lane does, so the reported
			// duration is the hooks' and not ~0
			let cache: any[] | undefined
			let reports: unknown[] | undefined
			if (traceAfterResponsePhase) {
				cache = (context as any).trace as any[] | undefined

				// A matched route traced itself with the tracers registered
				// before it: never start the app's, a later one included
				if (!cache && tracerFactories && afterResponses !== null) {
					context.rid ??= requestId()
					cache = tracerFactories.map((f) => f(context as any))
					;(context as any).trace = cache
				}

				if (cache) {
					const total = afterResponses?.length ?? 0
					reports = new Array(cache.length)
					for (let i = 0; i < cache.length; i++)
						// subscription-gated: unsubscribed = flat
						// timestamps only (no recorder/literal)
						reports[i] =
							cache[i].b(7, total) ||
							cache[i].begin(7, {
								id: context.rid ?? '',
								event: 'afterResponse',
								name: 'afterResponse',
								begin: performance.now(),
								total
							})
				}
			}

			if (afterResponses)
				for (let i = 0; i < afterResponses.length; i++)
					try {
						await afterResponses[i](context as any)
					} catch (e) {
						console.error(e)
					}

			const deferred = (context as any)['~afterResponse'] as
				| ((context: Context) => unknown)[]
				| undefined

			if (deferred) {
				const total = deferred.length

				for (let i = 0; i < total; i++)
					try {
						await deferred[i](context)
					} catch (e) {
						console.error(e)
					}
			}

			// derive values are released after the user's own callbacks
			await drainDisposables(context)

			if (reports)
				for (let i = 0; i < reports.length; i++) cache![i].r(reports[i])
		})
	}

	const fail = (
		context: Context,
		error: Error,
		sign?: (set: Context['set']) => unknown
	) => finalizeError(context, handleError, afterResponse, error, sign)

	const routeAfterResponse = (context: Context, status?: number) =>
		afterResponse(context, status, null)

	// what a matched route throws: before routing, `fail`
	const failRoute: typeof fail = (context, error, sign) =>
		finalizeError(
			context,
			handleRouteError,
			routeAfterResponse,
			error,
			sign
		)

	const routeHandlers = new WeakMap<object, typeof handleRouteError>()

	app['~finalizeError'] = (context, error, sign, wholeChain, route) => {
		if (wholeChain) return fail(context, error, sign)
		if (!route) return failRoute(context, error, sign)

		let handle = routeHandlers.get(route)
		if (!handle) {
			const withHooks = createErrorHandler(
				route.error?.length ? (route.error as any) : undefined,
				(route.mapResponse?.length
					? mapWithHooks.bind(null, route.mapResponse as any)
					: plainMap) as any,
				allowUnsafe
			)

			handle = (context, error, sign) => {
				const set = context.set as { '~signFailed'?: true }
				const end = () =>
					handleRouteError(
						context,
						set['~signFailed'] ? new InternalServerError() : error,
						sign
					)

				if (set['~signFailed']) return end()

				const signed = (r: unknown) => (set['~signFailed'] ? end() : r)

				try {
					const response = withHooks(context, error, sign)

					return response instanceof Promise
						? response.then(signed, end)
						: signed(response)
				} catch {
					return end()
				}
			}

			routeHandlers.set(route, handle)
		}

		return finalizeError(context, handle, routeAfterResponse, error, sign)
	}

	const onNotFound = (context: Context) => {
		if (hasError)
			return finalizeError(
				context,
				handleError,
				afterResponse,
				new NotFound()
			)

		afterResponse(context, 404)
		return notFound(context)
	}

	if (traceRequestPhase) {
		const onRequests = requestHooks ?? []

		return async (
			request: Request,
			server?: unknown
		): Promise<Response> => {
			const context = new Context(request)
			materializeSetHeaders(context.set)
			if (armEager(request, context))
				return emptyResponse.clone() as Response

			const path = extractPath(request.url, context)
			// @ts-expect-error
			context.server = server ?? null

			context.rid = requestId()

			const traceLength = tracerFactories!.length
			const trace: any[] = new Array(traceLength)
			for (let i = 0; i < traceLength; i++)
				trace[i] = tracerFactories![i](context as any)

			// @ts-expect-error private property
			context.trace = trace

			const requestReports = new Array(traceLength)
			for (let i = 0; i < traceLength; i++)
				requestReports[i] =
					trace[i].b(0, onRequests.length) ||
					trace[i].begin(0, {
						id: context.rid,
						event: 'request',
						name: 'request',
						begin: performance.now(),
						total: onRequests.length
					})

			let routed = false
			try {
				const endReports = new Array(traceLength)
				for (let i = 0; i < onRequests.length; i++) {
					for (let j = 0; j < traceLength; j++)
						endReports[j] = requestReports[j].shift?.()?.({
							id: context.rid,
							event: 'request',
							name: (onRequests[i] as any).name || 'anonymous',
							begin: performance.now()
						})

					let result = onRequests[i](context as any)
					if (typeof (result as any)?.then === 'function') {
						if (abortSignal)
							(context as any)['~sig'] ??= request.signal
						result = await result
					}

					if (watchPath && context.path !== path)
						warnPathMutation(app)

					for (let i = 0; i < traceLength; i++) endReports[i]?.()

					if (armedAbort(context)) {
						for (let j = 0; j < traceLength; j++)
							trace[j].r(requestReports[j])

						return emptyResponse.clone() as Response
					}

					if (result !== undefined) {
						for (let j = 0; j < traceLength; j++)
							trace[j].r(requestReports[j])

						const response = (await mapResponse(
							result,
							context.set,
							context
						)) as Response

						// eslint-disable-next-line sonarjs/no-use-of-empty-return-value -- optional call, result unused
						afterResponse?.(context)
						return response
					}
				}

				for (let i = 0; i < traceLength; i++)
					trace[i].r(requestReports[i])

				routed = true
				return await findRoute(
					context,
					request,
					map,
					router,
					onNotFound,
					handleRouteError,
					routeAfterResponse,
					strictPath,
					hasWS,
					hasDynamicWS,
					app
				)
			} catch (error) {
				for (let i = 0; i < traceLength; i++)
					trace[i].r(requestReports[i], error as Error)

				return (routed ? failRoute : fail)(context, error as Error)
			}
		}
	}

	if (requestHooks) {
		const onRequests = requestHooks

		if (hasAsync(onRequests))
			return async (
				request: Request,
				server?: unknown
			): Promise<Response> => {
				const context = new Context(request)
				materializeSetHeaders(context.set)
				if (armEager(request, context))
					return emptyResponse.clone() as Response

				const path = extractPath(request.url, context)
				// @ts-expect-error
				context.server = server ?? null

				let routed = false
				try {
					for (let i = 0; i < onRequests.length; i++) {
						let result = onRequests[i](context)
						if (typeof (result as any)?.then === 'function') {
							if (abortSignal)
								(context as any)['~sig'] ??= request.signal
							result = await result
						}

						if (watchPath && context.path !== path)
							warnPathMutation(app)

						if (armedAbort(context))
							return emptyResponse.clone() as Response

						if (result !== undefined) {
							const response = (await mapResponse(
								result,
								context.set,
								context
							)) as Response

							// eslint-disable-next-line sonarjs/no-use-of-empty-return-value -- optional call, result unused
							afterResponse?.(context)
							return response
						}
					}

					routed = true
					return findRoute(
						context,
						request,
						map,
						router,
						onNotFound,
						handleRouteError,
						routeAfterResponse,
						strictPath,
						hasWS,
						hasDynamicWS,
						app
					)
				} catch (error) {
					return (routed ? failRoute : fail)(context, error as Error)
				}
			}

		return (request: Request, server?: unknown): MaybePromise<Response> => {
			const context = new Context(request)
			materializeSetHeaders(context.set)
			if (armEager(request, context))
				return emptyResponse.clone() as Response

			const path = extractPath(request.url, context)
			// @ts-expect-error
			context.server = server ?? null

			let routed = false
			try {
				for (let i = 0; i < onRequests.length; i++) {
					const result = onRequests[i](context)
					if (watchPath && context.path !== path)
						warnPathMutation(app)

					if (abortSignal && (context as any)['~sig']?.aborted)
						return emptyResponse.clone() as Response

					if (result !== undefined) {
						const response = mapResponse(
							result,
							context.set,
							context
						) as Response | Promise<Response>

						if (response instanceof Promise)
							return response.then(
								(response) => {
									// eslint-disable-next-line sonarjs/no-use-of-empty-return-value -- optional call, result unused
									afterResponse?.(context)
									return response
								},
								catchError(context, handleError, afterResponse)
							)

						// eslint-disable-next-line sonarjs/no-use-of-empty-return-value -- optional call, result unused
						afterResponse?.(context)
						return response
					}
				}

				routed = true
				return findRoute(
					context,
					request,
					map,
					router,
					onNotFound,
					handleRouteError,
					routeAfterResponse,
					strictPath,
					hasWS,
					hasDynamicWS,
					app
				)
			} catch (error) {
				return (routed ? failRoute : fail)(context, error as Error)
			}
		}
	}

	return (request: Request, server?: unknown): MaybePromise<Response> => {
		const context = new Context(request)

		extractPath(request.url, context)
		// @ts-expect-error
		context.server = server ?? null

		try {
			return findRoute(
				context,
				request,
				map,
				router,
				onNotFound,
				handleRouteError,
				routeAfterResponse,
				strictPath,
				hasWS,
				hasDynamicWS,
				app
			)
		} catch (error) {
			return failRoute(context, error as Error)
		}
	}
}

export function applyHoc(
	app: AnyElysia,
	fetch: (request: Request, ...rest: any[]) => MaybePromise<Response>
): (request: Request, ...rest: any[]) => MaybePromise<Response> {
	const hoc = app['~ext']?.hoc
	if (!hoc?.length) return fetch

	let handler = fetch
	for (let i = hoc.length - 1; i >= 0; i--) handler = hoc[i](handler)

	return handler
}
