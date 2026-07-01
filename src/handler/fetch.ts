import { decodeComponent } from 'deuri'

import { defaultAdapter } from '../adapter/constants'

import type { AnyElysia } from '../base'
import { getAsyncIndexes, cachedResponse } from './utils'

import { createContext, type Context } from '../context'
import { createErrorHandler } from './error'
import {
	requestId,
	flattenChain,
	nullObject,
	isNotEmpty
} from '../utils'
import { handleSet } from '../adapter/utils'
import { NotFound, PROBLEM_JSON } from '../error'
import { createTracer } from '../trace'

import type { CompiledHandler, MaybePromise } from '../types'

// RFC 9457 problem+json for the default unmatched-route 404
const NOT_FOUND_BODY = JSON.stringify({
	type: 'not-found',
	title: 'Not Found',
	status: 404
})
const getNotFound = cachedResponse(NOT_FOUND_BODY, 404, {
	'content-type': PROBLEM_JSON
})

// Default 404 that still emits `Elysia.headers` defaults / hook-set headers + cookies.
function notFound(context: Context): Response {
	const set = context.set

	if (set.cookie || isNotEmpty(set.headers)) {
		handleSet(set)

		if (!(set.headers as any)['content-type'])
			(set.headers as any)['content-type'] = PROBLEM_JSON

		return new Response(NOT_FOUND_BODY, {
			status: 404,
			headers: set.headers as any
		})
	}

	return getNotFound()
}

const decodeParams = (
	params: Record<string, string>
): Record<string, string> => {
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
) {
	const resp = handleError(context, error) as Response | Promise<Response>
	if (!afterResponse) return resp

	if (resp instanceof Promise)
		return resp.then((r) => {
			afterResponse(context)
			return r
		})

	afterResponse(context)

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

function findRoute(
	context: Context,
	request: Request,
	map: NonNullable<AnyElysia['~map']>,
	router: NonNullable<AnyElysia['~router']>,
	hasError: boolean,
	handleError: (context: Context, error: Error) => unknown,
	afterResponse: ((context: Context, status?: number) => void) | undefined,
	strictPath: boolean,
	hasWS?: boolean
): Response | Promise<Response> {
	const path = context.path

	if (hasWS) {
		const upgrade = request.headers.get('upgrade')
		if (upgrade && upgrade.toLowerCase() === 'websocket') {
			const handler = map['WS']?.[path]

			if (handler) {
				const r = handler(context)
				return r instanceof Promise ? (r.catch(catchError(context, handleError, afterResponse)) as any) : r
			}

			const found = router?.find('WS', path)
			if (found) {
				context.params = decodeParams(found.params)
				const r = found.store(context)
				return r instanceof Promise ? (r.catch(catchError(context, handleError, afterResponse)) as any) : r
			}
		}
	}

	// Non-upgrade requests (and upgrades that match no WS route) fall through
	// to normal HTTP routing — WS presence must not shadow HTTP routes.
	{
		const methodMap = map[request.method]
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
			} else {
				const anyMap = map['*']
				handler = anyMap?.[path]
			}
		}

		if (handler) {
			const r = handler(context)
			return r instanceof Promise ? r.catch(catchError(context, handleError, afterResponse)) : r
		}

		const found =
			router?.find(request.method, path) ?? router?.find('*', path)

		if (found) {
			context.params = decodeParams(found.params)

			const r = found.store(context)
			return r instanceof Promise ? r.catch(catchError(context, handleError, afterResponse)) : r
		}
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

	const tracerFactories = hasTrace
		? traceHandlers!.map((fn) => createTracer(fn as any))
		: undefined

	const afterResponses = hook?.afterResponse
	const afterResponse =
		afterResponses?.length || hasTrace
			? (context: Context, status?: number) => {
					if ((context as any)._arf) return
					;(context as any)._arf = true

					if (status !== undefined) context.set.status = status

					queueMicrotask(async () => {
						if (afterResponses)
							for (let i = 0; i < afterResponses.length; i++)
								try {
									await afterResponses[i](context as any)
								} catch (e) {
									console.error(e)
								}

						if (hasTrace) {
							const cache = (context as any).trace as
								| any[]
								| undefined

							if (cache)
								for (let i = 0; i < cache.length; i++) {
									const r = cache[i].afterResponse({
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

	if (hasTrace) {
		const onRequests = hook?.request ?? []
		const asyncIndexes = onRequests.length
			? getAsyncIndexes(onRequests)
			: undefined

		return async (request: Request): Promise<Response> => {
			const context = new Context(request)
			const url = request.url,
				s = url.indexOf('/', pathStart)
			context.path = url.substring(
				s,
				// @ts-expect-error
				(context.qi = url.indexOf('?', s)) === -1
					? url.length
					: // @ts-expect-error
						context.qi
			)

			context.rid = requestId()

			const traceLength = tracerFactories!.length
			const trace: any[] = new Array(traceLength)
			for (let i = 0; i < traceLength; i++)
				trace[i] = tracerFactories![i](context as any)

			// @ts-expect-error private property
			context.trace = trace

			const requestReports = new Array(traceLength)
			for (let i = 0; i < traceLength; i++)
				requestReports[i] = trace[i].request({
					id: context.rid,
					event: 'request',
					name: 'request',
					begin: performance.now(),
					total: onRequests.length
				})

			try {
				for (let i = 0; i < onRequests.length; i++) {
					const endReports = new Array(traceLength)
					for (let j = 0; j < traceLength; j++)
						endReports[j] = requestReports[j].resolveChild
							?.shift?.()
							?.({
								id: context.rid,
								event: 'request',
								name:
									(onRequests[i] as any).name || 'anonymous',
								begin: performance.now()
							})

					const result = asyncIndexes?.[i]
						? await onRequests[i](context as any)
						: onRequests[i](context as any)

					for (let i = 0; i < traceLength; i++) endReports[i]?.()

					if (result !== undefined) {
						for (let j = 0; j < traceLength; j++)
							requestReports[j].resolve()
						const response = mapResponse(
							result,
							context.set
						) as Response

						afterResponse?.(context)
						return response
					}
				}

				for (let i = 0; i < traceLength; i++)
					requestReports[i].resolve()

				return await findRoute(
					context,
					request,
					map,
					router,
					hasError,
					handleError,
					afterResponse,
					strictPath,
					hasWS
				)
			} catch (error) {
				for (let i = 0; i < traceLength; i++)
					requestReports[i].resolve(error)

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
			return async (request: Request): Promise<Response> => {
				const context = new Context(request)
				const url = request.url,
					s = url.indexOf('/', pathStart)

				context.path = url.substring(
					s,
					// @ts-expect-error
					(context.qi = url.indexOf('?', s)) === -1
						? url.length
						: // @ts-expect-error
							context.qi
				)

				try {
					for (let i = 0; i < onRequests.length; i++) {
						const result = asyncIndexes?.[i]
							? await onRequests[i](context)
							: onRequests[i](context)

						if (result !== undefined) {
							const response = mapResponse(
								result,
								context.set
							) as Response

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
						hasWS
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

		return (request: Request): MaybePromise<Response> => {
			const context = new Context(request)
			const url = request.url,
				s = url.indexOf('/', pathStart)

			context.path = url.substring(
				s,
				// @ts-expect-error
				(context.qi = url.indexOf('?', s)) === -1
					? url.length
					: // @ts-expect-error
						context.qi
			)

			try {
				for (let i = 0; i < onRequests.length; i++) {
					const result = onRequests[i](context)
					if (result !== undefined) {
						const response = mapResponse(
							result,
							context.set
						) as Response

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
					hasWS
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

	// Fuck DRY, this is the hotest path
	// so I'm inline the entire thing, ~4-5ns faster on M1
	return (request: Request): MaybePromise<Response> => {
		const context = new Context(request)
		const url = request.url,
			s = url.indexOf('/', pathStart)

		const path = (context.path = url.substring(
			s,
			// @ts-expect-error
			(context.qi = url.indexOf('?', s)) === -1
				? url.length
				: // @ts-expect-error
					context.qi
		))

		if (hasWS) {
			const upgrade = request.headers.get('upgrade')
			if (upgrade && upgrade.toLowerCase() === 'websocket') {
				// Loose variants are pre-registered in `~map` (build time).
				const handler = map['WS']?.[path]

				try {
					if (handler) {
						const r = handler(context)
						return r instanceof Promise
							? (r.catch(catchError(context, handleError, afterResponse)) as any)
							: (r as any)
					}

					const found = router?.find('WS', path)
					if (found) {
						context.params = decodeParams(found.params)
						const r = found.store(context)
						return r instanceof Promise
							? (r.catch(catchError(context, handleError, afterResponse)) as any)
							: (r as any)
					}
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

		const methodMap = map[request.method]
		let handler: CompiledHandler | undefined = methodMap?.[path]

		try {
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
				} else {
					const anyMap = map['*']
					handler = anyMap?.[path]
				}
			}

			if (handler) {
				const r = handler(context)
				return r instanceof Promise ? r.catch(catchError(context, handleError, afterResponse)) : r
			}

			const result =
				router?.find(request.method, path) ?? router?.find('*', path)

			if (result) {
				context.params = decodeParams(result.params)

				const r = result.store(context)
				return r instanceof Promise ? r.catch(catchError(context, handleError, afterResponse)) : r
			}
		} catch (error) {
			return finalizeError(
				context,
				handleError,
				afterResponse,
				error as Error
			)
		}

		if (hasError) {
			return finalizeError(
				context,
				handleError,
				afterResponse,
				new NotFound()
			)
		}

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
