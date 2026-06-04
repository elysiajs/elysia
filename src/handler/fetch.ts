import { decodeComponent } from 'deuri'

import { defaultAdapter } from '../adapter/constants'

import type { AnyElysia } from '../base'
import { getAsyncIndexes } from './utils'

import { createContext, type Context } from '../context'
import { createErrorHandler } from './error'
import { requestId, flattenChain, getLoosePath, nullObject } from '../utils'
import { NotFound } from '../error'
import { createTracer } from '../trace'
import { isCloudflareWorker } from '../universal/constants'

import type { CompiledHandler, MaybePromise } from '../types'

let _notFound: Response | undefined
const getNotFound = (): Response =>
	isCloudflareWorker
		? new Response('Not Found', { status: 404 })
		: (_notFound ??= new Response('Not Found', { status: 404 })).clone()

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
	loosePath: Record<string, string>,
	handleError: (context: Context, error: Error) => unknown,
	afterResponse: ((context: Context, status?: number) => void) | undefined,
	hasWS?: boolean
): Response | Promise<Response> {
	let path = context.path
	const onError = catchError(context, handleError, afterResponse)

	if (hasWS) {
		const upgrade = request.headers.get('upgrade')
		if (upgrade && upgrade.toLowerCase() === 'websocket') {
			const handler =
				map['WS']?.[path] ??
				map['WS']?.[(loosePath[path] ??= getLoosePath(path))]

			if (handler) {
				const r = handler(context)
				return r instanceof Promise ? (r.catch(onError) as any) : r
			} else {
				// 1 time cost for non-encoded paths
				const [decoded, handler] = getDecodedPathHandler(
					path,
					'WS',
					map,
					loosePath
				)
				path = decoded
				if (handler) return handler(context)
			}

			const found = router?.find('WS', path)
			if (found) {
				context.params = found.params
				const r = found.store(context)
				return r instanceof Promise ? (r.catch(onError) as any) : r
			}
		}
	} else {
		const paths = map[request.method]
		const handler: CompiledHandler =
			paths?.[path] ??
			paths?.[(loosePath[path] ??= getLoosePath(path))] ??
			map['*']?.[path] ??
			map['*']?.[loosePath[path]]

		if (handler) {
			const r = handler(context)

			return r instanceof Promise ? r.catch(onError) : r
		} else {
			// 1 time cost for non-encoded paths
			const [decoded, handler] = getDecodedPathHandler(
				path,
				request.method,
				map,
				loosePath
			)
			path = decoded
			if (handler) return handler(context)
		}

		// Mirror the static-map's `map['*']` fallback: try the request's
		// method first, then fall back to wildcard-method (`.all()`) entries.
		// Without this, dynamic `.all('/x/:id')` routes never match — only
		// static `.all('/x')` does.
		const found =
			router.find(request.method, path) ?? router.find('*', path)

		if (found) {
			context.params = found.params

			const r = found.store(context)
			return r instanceof Promise ? r.catch(onError) : r
		}
	}

	if (hasError) throw new NotFound()

	afterResponse?.(context, 404)
	return getNotFound()
}

function getDecodedPathHandler(
	path: string,
	method: string,
	map: NonNullable<AnyElysia['~map']>,
	loosePath: Record<string, string>
) {
	const decoded = decodeComponent(path) ?? path
	if (decoded === path) return [decoded] as const

	let handler: CompiledHandler | undefined
	let _map = map[method]

	if (_map)
		handler =
			_map[decoded] ??
			_map[(loosePath[decoded] ??= getLoosePath(decoded))]

	if (!handler) {
		_map = map['*']

		if (_map)
			handler =
				_map[decoded] ??
				_map[(loosePath[decoded] ??= getLoosePath(decoded))]
	}

	if (handler) {
		_map[path] = handler
		delete map[decoded]

		return [decoded, handler] as const
	}

	return [decoded] as const
}

export function createFetchHandler(
	app: AnyElysia
): (request: Request) => MaybePromise<Response> {
	const Context = createContext(app)
	const map = app['~map']! ?? nullObject()
	const router = app['~router']!
	const hasWS = !!app['~hasWS']

	const loosePath = nullObject()

	const hook = flattenChain(app['~hookChain'])
	const hasError = !!hook?.error

	const mapResponse = (app['~config']?.adapter ?? defaultAdapter).response.map
	const handleError = createErrorHandler(hook?.error, mapResponse)

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
				s = url.indexOf('/', 11)
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

					// `endReports[i]` is the closer FUNCTION returned by
					// `resolveChild?.shift?.()?.({...})`, not a report object.
					// Call it directly to finalize the child; only the parent
					// report has a `.resolve()` method.
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
					loosePath,
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
					s = url.indexOf('/', 11)

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
						loosePath,
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
				s = url.indexOf('/', 11)

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
					loosePath,
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
			s = url.indexOf('/', 11)

		let path = (context.path = url.substring(
			s,
			// @ts-expect-error
			(context.qi = url.indexOf('?', s)) === -1
				? url.length
				: // @ts-expect-error
					context.qi
		))

		const onError = catchError(context, handleError, afterResponse)

		// WS upgrade pre-check. `~hasWS` lets HTTP-only apps take no
		// branch; apps with WS routes pay a single header read.
		// WS routes share `~map`/`~router` under the synthetic method `'WS'`.
		if (hasWS) {
			const upgrade = request.headers.get('upgrade')
			if (upgrade && upgrade.toLowerCase() === 'websocket') {
				const handler =
					map['WS']?.[path] ??
					map['WS']?.[(loosePath[path] ??= getLoosePath(path))]

				try {
					if (handler) {
						const r = handler(context)
						return r instanceof Promise
							? (r.catch(onError) as any)
							: (r as any)
					} else {
						// 1 time cost for non-encoded paths
						const [decoded, handler] = getDecodedPathHandler(
							path,
							'WS',
							map,
							loosePath
						)
						path = decoded
						if (handler) return handler(context)
					}

					const found = router?.find('WS', path)
					if (found) {
						context.params = found.params
						const r = found.store(context)
						return r instanceof Promise
							? (r.catch(onError) as any)
							: (r as any)
					}
				} catch (error) {
					const r = handleError(context, error as Error) as Response
					afterResponse?.(context)
					return r
				}
			}
		}

		let handler: CompiledHandler =
			map[request.method]?.[path] ??
			map[request.method]?.[(loosePath[path] ??= getLoosePath(path))] ??
			map['*']?.[path] ??
			map['*']?.[loosePath[path]]

		try {
			if (handler) {
				const r = handler(context)
				return r instanceof Promise ? r.catch(onError) : r
			} else {
				// 1 time cost for non-encoded paths
				const [decoded, handler] = getDecodedPathHandler(
					path,
					request.method,
					map,
					loosePath
				)
				path = decoded

				if (handler) return handler(context)
			}

			const result =
				router?.find(request.method, path) ?? router?.find('*', path)
			if (result) {
				context.params = result.params

				const r = result.store(context)
				return r instanceof Promise ? r.catch(onError) : r
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
