import { decodeComponent } from 'deuri'

import { defaultAdapter } from '../adapter/constants'

import type { AnyElysia } from '../base'
import { getAsyncIndexes, cachedResponse } from './utils'

import { createContext, type Context } from '../context'
import { createErrorHandler } from './error'
import { requestId, flattenChain, nullObject } from '../utils'
import { NotFound } from '../error'
import { createTracer } from '../trace'

import type { CompiledHandler, MaybePromise } from '../types'

const getNotFound = cachedResponse('Not Found', 404)

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

const catchError =
	(
		context: Context,
		handleError: (context: Context, error: Error) => unknown,
		afterResponse: ((context: Context, status?: number) => void) | undefined
	) =>
	(error: Error) => {
		const resp = handleError(context, error) as Response
		afterResponse?.(context)
		return resp
	}

function findRoute(
	context: Context,
	request: Request,
	map: NonNullable<AnyElysia['~map']>,
	router: NonNullable<AnyElysia['~router']>,
	hasError: boolean,
	handleError: (context: Context, error: Error) => unknown,
	afterResponse: ((context: Context, status?: number) => void) | undefined,
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
	} else {
		const handler: CompiledHandler =
			map[request.method]?.[path] ?? map['*']?.[path]

		if (handler) {
			const r = handler(context)

			return r instanceof Promise ? r.catch(catchError(context, handleError, afterResponse)) : r
		}

		const found =
			router.find(request.method, path) ?? router.find('*', path)

		if (found) {
			context.params = decodeParams(found.params)

			const r = found.store(context)
			return r instanceof Promise ? r.catch(catchError(context, handleError, afterResponse)) : r
		}
	}

	if (hasError) throw new NotFound()

	afterResponse?.(context, 404)
	return getNotFound()
}

export function createFetchHandler(
	app: AnyElysia
): (request: Request) => MaybePromise<Response> {
	const Context = createContext(app)
	const map = app['~map']! ?? nullObject()
	const router = app['~router']!
	const hasWS = !!app['~hasWS']

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

			const requestReports = trace.map((c) =>
				c.request({
					id: context.rid,
					event: 'request',
					name: 'request',
					begin: performance.now(),
					total: onRequests.length
				})
			)

			try {
				for (let i = 0; i < onRequests.length; i++) {
					const endReports = requestReports.map((r) =>
						r.resolveChild?.shift?.()?.({
							id: context.rid,
							event: 'request',
							name: (onRequests[i] as any).name || 'anonymous',
							begin: performance.now()
						})
					)

					const result = asyncIndexes?.[i]
						? await onRequests[i](context as any)
						: onRequests[i](context as any)

					for (let i = 0; i < traceLength; i++) endReports[i]?.()

					if (result !== undefined) {
						requestReports.forEach((r) => r.resolve())
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
					hasWS
				)
			} catch (error) {
				for (let i = 0; i < traceLength; i++)
					requestReports[i].resolve(error)

				const r = handleError(context, error as Error) as Response
				afterResponse?.(context)
				return r
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

						if (result !== undefined)
							return mapResponse(result, context.set) as Response
					}

					return findRoute(
						context,
						request,
						map,
						router,
						hasError,
						handleError,
						afterResponse,
						hasWS
					)
				} catch (error) {
					const r = handleError(context, error as Error) as Response
					afterResponse?.(context)
					return r
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
					if (result !== undefined)
						return mapResponse(result, context.set) as Response
				}

				return findRoute(
					context,
					request,
					map,
					router,
					hasError,
					handleError,
					afterResponse,
					hasWS
				)
			} catch (error) {
				return handleError(context, error as Error) as Response
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
					const r = handleError(context, error as Error) as Response
					afterResponse?.(context)
					return r
				}
			}
		}

		const handler: CompiledHandler =
			map[request.method]?.[path] ?? map['*']?.[path]

		try {
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
			const r = handleError(context, error as Error) as Response
			afterResponse?.(context)
			return r
		}

		if (hasError) {
			const r = handleError(context, new NotFound()) as Response
			afterResponse?.(context, 404)
			return r
		}

		afterResponse?.(context, 404)
		return getNotFound()
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
