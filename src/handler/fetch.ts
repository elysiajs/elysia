import { decodeComponent } from 'deuri'

import { defaultAdapter } from '../adapter/constants'

import type { AnyElysia } from '../base'
import {
	getAsyncIndexes,
	emptyResponse,
	NOT_FOUND_BODY,
	getNotFound
} from './utils'

import { createContext, type Context } from '../context'
import { createErrorHandler } from './error'
import { requestId, flattenChain, nullObject, isNotEmpty } from '../utils'
import { handleSet, materializeSetHeaders } from '../adapter/utils'
import {
	NotFound,
	PROBLEM_JSON,
	internalServerErrorResponse,
	isProduction
} from '../error'
import { createTracer, unionTracePhases } from '../trace'

import type { CompiledHandler, MaybePromise } from '../types'

// Extract path and query-index from a full URL string.
// Scalar params only — monomorphic so V8/JSC can inline at each call site.
function extractPath(url: string, context: any, pathStart: number): string {
	const s = url.indexOf('/', pathStart)
	return (context.path = url.substring(
		s,
		(context.qi = url.indexOf('?', s)) === -1 ? url.length : context.qi
	))
}

// Default 404 that still emits `Elysia.headers` defaults / hook-set headers + cookies.
function notFound(context: Context): Response {
	const set = context.set

	if (set.cookie || isNotEmpty(set.headers)) {
		handleSet(set)

		if (!(set.headers as any)['content-type'])
			(materializeSetHeaders(set) as any)['content-type'] = PROBLEM_JSON

		return new Response(NOT_FOUND_BODY, {
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

function finalizeError(
	context: Context,
	handleError: (context: Context, error: Error) => unknown,
	afterResponse: ((context: Context, status?: number) => void) | undefined,
	error: Error
): Response | Promise<Response> {
	let resp: Response | Promise<Response>
	try {
		resp = handleError(context, error) as Response | Promise<Response>
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
	hasError: boolean,
	handleError: (context: Context, error: Error) => unknown,
	afterResponse: ((context: Context, status?: number) => void) | undefined,
	strictPath: boolean,
	hasWS?: boolean,
	hasDynamicWS?: boolean
): Response | Promise<Response> {
	const path = context.path

	if (hasWS && request.method === 'GET') {
		const handler = map['WS']?.[path]
		const found =
			handler === undefined && hasDynamicWS
				? router?.find('WS', path)
				: undefined

		if (handler !== undefined || found) {
			const upgrade = request.headers.get('upgrade')
			if (upgrade && upgrade.toLowerCase() === 'websocket') {
				if (handler) {
					const r = handler(context)
					return r instanceof Promise
						? (r.catch(
								catchError(context, handleError, afterResponse)
							) as any)
						: r
				}

				context.params = decodeParams(found!.params)
				const r = found!.store(context)
				return r instanceof Promise
					? (r.catch(
							catchError(context, handleError, afterResponse)
						) as any)
					: r
			}
		}
	}

	const method = request.method
	const methodMap = map[method]
	let handler: CompiledHandler | undefined = methodMap?.[path]

	if (!handler) {
		if (
			!strictPath &&
			path.length > 1 &&
			path.charCodeAt(path.length - 1) === 47
		) {
			const loose = path.slice(0, -1)
			handler = methodMap?.[loose]

			if (!handler) {
				const anyMap = map['*']
				handler = anyMap?.[path] ?? anyMap?.[loose]
			}
		} else handler = map['*']?.[path]
	}

	if (handler)
		return dispatchResult(
			handler(context),
			context,
			handleError,
			afterResponse
		)

	const found = router?.find(method, path) ?? router?.find('*', path)

	if (found) {
		context.params = decodeParams(found.params)

		return dispatchResult(
			found.store(context),
			context,
			handleError,
			afterResponse
		)
	}

	if (hasError) throw new NotFound()

	afterResponse?.(context, 404)
	return notFound(context)
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

	// standard internet hostname is at minimum 11 characters (http://a.bc)
	const pathStart =
		app['~config']?.handler?.standardHostname === false ? 7 : 11

	const hook = flattenChain(app['~hookChain'])
	const hasError = !!hook?.error

	const baseMapResponse = (app['~config']?.adapter ?? defaultAdapter).response
		.map as (
		response: unknown,
		set: Context['set'],
		request?: Request
	) => unknown

	const mapResponseHooks = hook?.mapResponse as
		| ((context: Context) => unknown)[]
		| undefined
	const mapResponse = mapResponseHooks?.length
		? (response: unknown, set: Context['set'], context?: Context) => {
				if (!context) return baseMapResponse(response, set)
				;(context as { responseValue?: unknown }).responseValue =
					response

				const request = context.request

				const run = (i: number): unknown => {
					for (; i < mapResponseHooks.length; i++) {
						const result = mapResponseHooks[i](context)

						if (result instanceof Promise)
							// eslint-disable-next-line sonarjs/function-inside-loop -- promise continuation for the hook at index i
							return result.then((resolved) => {
								if (resolved !== undefined)
									return baseMapResponse(
										resolved,
										set,
										request
									)

								return run(i + 1)
							})

						if (result !== undefined)
							return baseMapResponse(result, set, request)
					}

					return baseMapResponse(response, set, request)
				}

				return run(0)
			}
		: (response: unknown, set: Context['set'], context?: Context) =>
				baseMapResponse(
					response,
					set,
					(context as { request?: Request } | undefined)?.request
				)

	const handleError = createErrorHandler(
		hook?.error,
		mapResponse as any,
		undefined,
		app['~config']?.allowUnsafeValidationDetails
	)

	const traceHandlers = hook?.trace as
		| ((context: any) => unknown)[]
		| undefined

	const hasTrace = !!traceHandlers?.length

	const tracePhases = hasTrace
		? unionTracePhases(traceHandlers as unknown as Function[])
		: null

	const traceRequestPhase =
		hasTrace && (tracePhases === null || tracePhases.has('request'))

	const traceAfterResponsePhase =
		hasTrace && (tracePhases === null || tracePhases.has('afterResponse'))

	const tracerFactories = hasTrace
		? traceHandlers!.map((fn) => createTracer(fn as any))
		: undefined

	const afterResponses = hook?.afterResponse
	const afterResponse =
		afterResponses?.length || traceAfterResponsePhase
			? (context: Context, status?: number) => {
					if ((context as any)._arf) return
					;(context as any)._arf = true

					if (status !== undefined) context.set.status = status

					queueMicrotask(async () => {
						if (afterResponses) {
							materializeSetHeaders(context.set)
							for (let i = 0; i < afterResponses.length; i++)
								try {
									await afterResponses[i](context as any)
								} catch (e) {
									console.error(e)
								}
						}

						if (traceAfterResponsePhase) {
							let cache = (context as any).trace as
								| any[]
								| undefined

							if (!cache && tracerFactories) {
								context.rid ??= requestId()
								cache = tracerFactories.map((f) =>
									f(context as any)
								)
								;(context as any).trace = cache
							}

							if (cache)
								for (let i = 0; i < cache.length; i++) {
									// subscription-gated: unsubscribed = flat
									// timestamps only (no recorder/literal)
									const fast = cache[i].b(
										7,
										afterResponses?.length ?? 0
									)
									if (fast) {
										cache[i].r(fast)
										continue
									}

									const r = cache[i].begin(7, {
										id: context.rid ?? '',
										event: 'afterResponse',
										name: 'afterResponse',
										begin: performance.now(),
										total: afterResponses?.length ?? 0
									})
									r.resolve()
								}
						}
					})
				}
			: undefined

	app['~finalizeError'] = (context, error) =>
		finalizeError(context, handleError, afterResponse, error)

	if (traceRequestPhase) {
		const onRequests = hook?.request ?? []
		const asyncIndexes = onRequests.length
			? getAsyncIndexes(onRequests)
			: undefined

		return async (
			request: Request,
			server?: unknown
		): Promise<Response> => {
			const context = new Context(request)
			materializeSetHeaders(context.set)
			if (request.signal.aborted) return emptyResponse.clone() as Response

			extractPath(request.url, context, pathStart)
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

			try {
				const endReports = new Array(traceLength)
				for (let i = 0; i < onRequests.length; i++) {
					for (let j = 0; j < traceLength; j++)
						endReports[j] = requestReports[
							j
						].resolveChild?.shift?.()?.({
							id: context.rid,
							event: 'request',
							name: (onRequests[i] as any).name || 'anonymous',
							begin: performance.now()
						})

					const result = asyncIndexes?.[i]
						? await onRequests[i](context as any)
						: onRequests[i](context as any)

					for (let i = 0; i < traceLength; i++) endReports[i]?.()

					if (request.signal.aborted) {
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

						afterResponse?.(context)
						return response
					}
				}

				for (let i = 0; i < traceLength; i++)
					trace[i].r(requestReports[i])

				return await findRoute(
					context,
					request,
					map,
					router,
					hasError,
					handleError,
					afterResponse,
					strictPath,
					hasWS,
					hasDynamicWS
				)
			} catch (error) {
				for (let i = 0; i < traceLength; i++)
					trace[i].r(requestReports[i], error as Error)

				return finalizeError(
					context,
					handleError,
					afterResponse,
					error as Error
				)
			}
		}
	}

	if (hook?.request) {
		const onRequests = hook.request
		const asyncIndexes = getAsyncIndexes(onRequests)

		if (asyncIndexes)
			return async (
				request: Request,
				server?: unknown
			): Promise<Response> => {
				const context = new Context(request)
				materializeSetHeaders(context.set)
				if (request.signal.aborted)
					return emptyResponse.clone() as Response

				extractPath(request.url, context, pathStart)
				// @ts-expect-error
				context.server = server ?? null

				try {
					for (let i = 0; i < onRequests.length; i++) {
						let result = asyncIndexes?.[i]
							? await onRequests[i](context)
							: onRequests[i](context)

						if (result instanceof Promise) result = await result

						if (request.signal.aborted)
							return emptyResponse.clone() as Response

						if (result !== undefined) {
							const response = (await mapResponse(
								result,
								context.set,
								context
							)) as Response

							afterResponse?.(context)
							return response
						}
					}

					return findRoute(
						context,
						request,
						map,
						router,
						hasError,
						handleError,
						afterResponse,
						strictPath,
						hasWS,
						hasDynamicWS
					)
				} catch (error) {
					return finalizeError(
						context,
						handleError,
						afterResponse,
						error as Error
					)
				}
			}

		return (request: Request, server?: unknown): MaybePromise<Response> => {
			const context = new Context(request)
			materializeSetHeaders(context.set)
			if (request.signal.aborted) return emptyResponse.clone() as Response

			extractPath(request.url, context, pathStart)
			// @ts-expect-error
			context.server = server ?? null

			try {
				for (let i = 0; i < onRequests.length; i++) {
					const result = onRequests[i](context)
					if (request.signal.aborted)
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
									afterResponse?.(context)
									return response
								},
								catchError(context, handleError, afterResponse)
							)

						afterResponse?.(context)
						return response
					}
				}

				return findRoute(
					context,
					request,
					map,
					router,
					hasError,
					handleError,
					afterResponse,
					strictPath,
					hasWS,
					hasDynamicWS
				)
			} catch (error) {
				return finalizeError(
					context,
					handleError,
					afterResponse,
					error as Error
				)
			}
		}
	}

	return (request: Request, server?: unknown): MaybePromise<Response> => {
		const context = new Context(request)
		const path = extractPath(request.url, context, pathStart)
		// @ts-expect-error
		context.server = server ?? null

		const method = request.method

		if (hasWS && method === 'GET') {
			const handler = map['WS']?.[path]
			const found =
				handler === undefined && hasDynamicWS
					? router?.find('WS', path)
					: undefined

			if (handler !== undefined || found) {
				const upgrade = request.headers.get('upgrade')
				if (upgrade && upgrade.toLowerCase() === 'websocket')
					try {
						if (handler) {
							const r = handler(context)
							return r instanceof Promise
								? (r.catch(
										catchError(
											context,
											handleError,
											afterResponse
										)
									) as any)
								: (r as any)
						}

						context.params = decodeParams(found!.params)
						const r = found!.store(context)
						return r instanceof Promise
							? (r.catch(
									catchError(
										context,
										handleError,
										afterResponse
									)
								) as any)
							: (r as any)
					} catch (error) {
						return finalizeError(
							context,
							handleError,
							afterResponse,
							error as Error
						)
					}
			}
		}

		try {
			const methodMap = map[method]

			let handler: CompiledHandler | undefined = methodMap?.[path]
			if (handler)
				return dispatchResult(
					handler(context),
					context,
					handleError,
					afterResponse
				)

			if (
				!strictPath &&
				path.length > 1 &&
				path.charCodeAt(path.length - 1) === 47
			) {
				const loose = path.slice(0, -1)
				handler = methodMap?.[loose]
				if (!handler) {
					const anyMap = map['*']
					handler = anyMap?.[path] ?? anyMap?.[loose]
				}
			} else handler = map['*']?.[path]

			if (handler)
				return dispatchResult(
					handler(context),
					context,
					handleError,
					afterResponse
				)

			const result =
				router?.find(method, path) ?? router?.find('*', path)

			if (result) {
				context.params = decodeParams(result.params)

				return dispatchResult(
					result.store(context),
					context,
					handleError,
					afterResponse
				)
			}
		} catch (error) {
			return finalizeError(
				context,
				handleError,
				afterResponse,
				error as Error
			)
		}

		if (hasError)
			return finalizeError(
				context,
				handleError,
				afterResponse,
				new NotFound()
			)

		afterResponse?.(context, 404)
		return notFound(context)
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
