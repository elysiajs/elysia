import { defaultAdapter } from '../adapter/constants'

import type { AnyElysia } from '../base'
import { getAsyncIndexes } from './utils'

import { createContext, type Context } from '../context'
import { createErrorHandler } from './error'
import { flattenChain, getLoosePath, nullObject } from '../utils'
import { NotFound } from '../error'

import type { CompiledHandler, MaybePromise } from '../types'

const notFound = new Response('Not Found', { status: 404 })

function findRoute(
	context: Context,
	request: Request,
	map: NonNullable<AnyElysia['~map']>,
	router: NonNullable<AnyElysia['~router']>,
	hasError: boolean,
	loosePath: NonNullable<AnyElysia['~loosePath']>,
	handleError: (context: Context, error: Error) => unknown
): Response | Promise<Response> {
	const url = request.url,
		s = url.indexOf('/', 11),
		path = url.substring(
			s,
			// @ts-expect-error
			(context.qi = url.indexOf('?', s)) === -1 ? url.length : context.qi
		)

	context.path = path

	const paths = map[request.method]
	const handler: CompiledHandler =
		paths?.[path] ?? paths?.[(loosePath[path] ??= getLoosePath(path))]

	if (handler) {
		const r = handler(context)
		if (r && typeof (r as PromiseLike<unknown>).then === 'function')
			return (r as Promise<Response>).catch(
				(error) => handleError(context, error as Error) as Response
			)
		return r as Response
	}

	const found = router.find(request.method, path)
	if (found) {
		context.params = found.params
		const r = found.store(context)
		if (r && typeof (r as PromiseLike<unknown>).then === 'function')
			return (r as Promise<Response>).catch(
				(error) => handleError(context, error as Error) as Response
			)
		return r as Response
	}

	if (hasError) throw new NotFound()

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

	if (hook?.request) {
		const onRequests = hook.request
		const asyncIndexes = getAsyncIndexes(onRequests)

		if (asyncIndexes)
			return async (request: Request): Promise<Response> => {
				const context = new Context(request)

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
						handleError
					)
				} catch (error) {
					return handleError(context, error as Error) as Response
				}
			}

		return (request: Request): MaybePromise<Response> => {
			const context = new Context(request)
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
					handleError
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

		try {
			if (handler) {
				const r = handler(context)
				if (r && typeof (r as PromiseLike<unknown>).then === 'function')
					return (r as Promise<Response>).catch(
						(error) =>
							handleError(context, error as Error) as Response
					)
				return r as Response
			}

			const result = router?.find(request.method, path)
			if (result) {
				context.params = result.params

				const r = result.store(context)
				if (r && typeof (r as PromiseLike<unknown>).then === 'function')
					return (r as Promise<Response>).catch(
						(error) =>
							handleError(context, error as Error) as Response
					)
				return r as Response
			}
		} catch (error) {
			return handleError(context, error as Error) as Response
		}

		if (hasError) return handleError(context, new NotFound()) as Response

		return notFound.clone() as Response
	}
}
