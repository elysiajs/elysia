import { defaultAdapter } from '../adapter/constants'

import type { AnyElysia } from '../base'
import { getAsyncIndexes } from './utils'

import { createContext, type Context } from '../context'
import { createErrorHandler } from './error'
import { flattenChain, getLoosePath, nullObject } from '../utils'
import { NotFound } from '../error'
import { AFTER_RESPONSE_FIRED } from '../constants'

import type { CompiledHandler, MaybePromise } from '../types'

const notFound = new Response('Not Found', { status: 404 })

// Common shape of every async-handler catch in this file: route the
// thrown error through `handleError`, then schedule `afterResponse`
// (so failed routes still fire app-level afterResponse hooks once).
const catchError = (
	context: Context,
	handleError: (context: Context, error: Error) => unknown,
	fireAppAfterResponse:
		| ((context: Context, status?: number) => void)
		| undefined
) => (error: unknown) => {
	const resp = handleError(context, error as Error) as Response
	fireAppAfterResponse?.(context)
	return resp
}

function findRoute(
	context: Context,
	request: Request,
	map: NonNullable<AnyElysia['~map']>,
	router: NonNullable<AnyElysia['~router']>,
	hasError: boolean,
	loosePath: NonNullable<AnyElysia['~loosePath']>,
	handleError: (context: Context, error: Error) => unknown,
	fireAppAfterResponse:
		| ((context: Context, status?: number) => void)
		| undefined
): Response | Promise<Response> {
	// `path` may already be seeded by the onRequest path (`seedPath`).
	let path = context.path
	if (path === undefined) {
		const url = request.url
		const s = url.indexOf('/', 11)
		// @ts-expect-error
		const qi = (context.qi = url.indexOf('?', s))
		path = context.path = url.substring(s, qi === -1 ? url.length : qi)
	}

	const paths = map[request.method]
	const handler: CompiledHandler =
		paths?.[path] ?? paths?.[(loosePath[path] ??= getLoosePath(path))]

	const onError = catchError(context, handleError, fireAppAfterResponse)

	if (handler) {
		const r = handler(context)
		if (r && typeof (r as PromiseLike<unknown>).then === 'function')
			return (r as Promise<Response>).catch(onError)
		return r as Response
	}

	const found = router.find(request.method, path)
	if (found) {
		context.params = found.params
		const r = found.store(context)
		if (r && typeof (r as PromiseLike<unknown>).then === 'function')
			return (r as Promise<Response>).catch(onError)
		return r as Response
	}

	if (hasError) throw new NotFound()

	fireAppAfterResponse?.(context, 404)
	return notFound.clone() as Response
}

export function createFetchHandler(
	app: AnyElysia
): (request: Request) => MaybePromise<Response> {
	const Context = createContext(app)
	const map = app['~map']! ?? nullObject()
	const router = app['~router']!
	const loosePath = (app['~loosePath'] ??= nullObject())

	// Materialize the cumulative hook view once at fetch-handler creation -
	// hot path closes over `hook`, so this runs only on first `app.fetch`.
	const hook = flattenChain(app['~ext']?.hookChain)
	const hasError = !!hook?.error

	const mapResponse = (app['~config']?.adapter ?? defaultAdapter).response.map
	const handleError = createErrorHandler(hook?.error, mapResponse)

	// App-level `afterResponse` for paths that don't go through a compiled
	// route — 404, errors caught at the dispatcher, pre-route exceptions.
	// Compiled routes set `c[AFTER_RESPONSE_FIRED] = true` in their codegen
	// schedule so this dedupes against them and doesn't double-fire.
	const appAfterResponse = hook?.afterResponse
	const fireAppAfterResponse = appAfterResponse?.length
		? (context: Context, status?: number) => {
				if ((context as any)[AFTER_RESPONSE_FIRED]) return
				;(context as any)[AFTER_RESPONSE_FIRED] = true
				if (status !== undefined) context.set.status = status
				queueMicrotask(async () => {
					// Per-hook isolation: a thrown hook shouldn't drop the
					// rest, and shouldn't surface as an unhandled rejection
					// (Bun reports those as `Unhandled error between tests`).
					for (let i = 0; i < appAfterResponse.length; i++)
						try {
							await appAfterResponse[i](context as any)
						} catch (e) {
							console.error(e)
						}
				})
			}
		: undefined

	if (hook?.request) {
		const onRequests = hook.request
		const asyncIndexes = getAsyncIndexes(onRequests)

		// `qi` is computed in `findRoute`/the inline hot path normally, but
		// `onRequest` hooks can read `c.qi` (and `c.path`) before route
		// matching. Pre-compute both up front so they're available.
		const seedPath = (context: Context, request: Request) => {
			const url = request.url
			const s = url.indexOf('/', 11)
			const qi = url.indexOf('?', s)
			;(context as any).qi = qi
			context.path = url.substring(s, qi === -1 ? url.length : qi)
		}

		if (asyncIndexes)
			return async (request: Request): Promise<Response> => {
				const context = new Context(request)
				seedPath(context, request)

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
						fireAppAfterResponse
					)
				} catch (error) {
					const r = handleError(context, error as Error) as Response
					fireAppAfterResponse?.(context)
					return r
				}
			}

		return (request: Request): MaybePromise<Response> => {
			const context = new Context(request)
			seedPath(context, request)
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
					fireAppAfterResponse
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
			s = url.indexOf('/', 11),
			path = (context.path = url.substring(
				s,
				// @ts-expect-error
				(context.qi = url.indexOf('?', s)) === -1
					? url.length
					: // @ts-expect-error
						context.qi
			))

		const handler: CompiledHandler =
			map[request.method]?.[path] ??
			map[request.method]?.[(loosePath[path] ??= getLoosePath(path))]

		const onError = catchError(context, handleError, fireAppAfterResponse)

		try {
			if (handler) {
				const r = handler(context)
				if (r && typeof (r as PromiseLike<unknown>).then === 'function')
					return (r as Promise<Response>).catch(onError)
				return r as Response
			}

			const result = router?.find(request.method, path)
			if (result) {
				context.params = result.params

				const r = result.store(context)
				if (r && typeof (r as PromiseLike<unknown>).then === 'function')
					return (r as Promise<Response>).catch(onError)
				return r as Response
			}
		} catch (error) {
			const r = handleError(context, error as Error) as Response
			fireAppAfterResponse?.(context)
			return r
		}

		if (hasError) {
			const r = handleError(context, new NotFound()) as Response
			fireAppAfterResponse?.(context, 404)
			return r
		}

		fireAppAfterResponse?.(context, 404)
		return notFound.clone() as Response
	}
}
