import { defaultAdapter } from '../adapter/constants'

import type { AnyElysia } from '../'
import { getAsyncIndexes } from './utils'

import { createContext, type Context } from '../context'
import type { CompiledHandler, AppHook, MaybePromise } from '../types'
import { createErrorHandler } from './error'
import { getLoosePath } from '../utils'

const notFound = new Response('Not Found', { status: 404 })

export function getPath(url: string) {
	const s = url.indexOf('/', 11),
		qi = url.indexOf('?', s + 1)

	return [url.substring(s, qi === -1 ? url.length : qi), qi] as const
}

function findRoute(
	context: Context,
	request: Request,
	map: NonNullable<AnyElysia['~map']>,
	router: NonNullable<AnyElysia['~router']>,
	hasError: boolean,
	loosePath: NonNullable<AnyElysia['~loosePath']>
): Response {
	const [path, qi] = getPath(request.url)
	// @ts-expect-error
	context.qi = qi

	const paths = map[request.method]
	const handler: CompiledHandler =
		paths?.[path] ?? paths?.[(loosePath[path] ??= getLoosePath(path))]
	if (handler) return handler(context) as Response

	const result = router.find(request.method, path)
	if (result) {
		context.params = result.params
		return result.store(context) as Response
	}

	if (hasError) throw new Error()

	return notFound.clone() as Response
}

export function createFetchHandler(
	app: AnyElysia
): (request: Request) => MaybePromise<Response> {
	const Context = createContext(app)
	const map = app['~map']!
	const router = app['~router']!
	const loosePath = (app['~loosePath'] ??= Object.create(null))

	const onErrors = app['~ext']?.hook?.error
	const hasError = !!onErrors
	const handleError = createErrorHandler(
		onErrors,
		(app['~config']?.adapter ?? defaultAdapter).response.map
	)

	if (app['~ext']?.hook?.request) {
		const onRequests = app['~ext'].hook.request!
		const asyncIndexes = getAsyncIndexes(onRequests)

		if (asyncIndexes)
			return async (request: Request): Promise<Response> => {
				const context = new Context(request)

				try {
					for (let i = 0; i < onRequests.length; i++)
						if (asyncIndexes?.[i]) await onRequests[i](context)
						else onRequests[i](context)

					return findRoute(
						context,
						request,
						map,
						router,
						hasError,
						loosePath
					)
				} catch (error) {
					return handleError(context, error as Error) as Response
				}
			}

		return (request: Request): Response => {
			const context = new Context(request)
			try {
				for (let i = 0; i < onRequests.length; i++)
					onRequests[i](context)

				return findRoute(
					context,
					request,
					map,
					router,
					hasError,
					loosePath
				)
			} catch (error) {
				return handleError(context, error as Error) as Response
			}
		}
	}

	// Fuck DRY, this is the hotest path
	// so I'm inline the entire thing, ~4-5ns faster on M1
	return (request: Request): Response => {
		const context = new Context(request)
		const url = request.url,
			s = url.indexOf('/', 11),
			qi = url.indexOf('?', s + 1),
			path = url.substring(s, qi === -1 ? url.length : qi)

		// @ts-expect-error
		context.qi = qi

		try {
			const inner = map[request.method]
			const handler: CompiledHandler =
				inner?.[path] ??
				inner?.[(loosePath[path] ??= getLoosePath(path))]
			if (handler) return handler(context) as Response
		} catch (error) {
			return handleError(context, error as Error) as Response
		}

		const result = router?.find(request.method, path)
		if (result) {
			context.params = result.params

			try {
				return result.store(context) as Response
			} catch (error) {
				return handleError(context, error as Error) as Response
			}
		}

		if (hasError) return handleError(context, new Error()) as Response

		return notFound.clone() as Response
	}
}
