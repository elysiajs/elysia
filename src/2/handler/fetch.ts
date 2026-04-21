import { redirect } from '../utils'

import { isAsyncFunction } from '../compile/utils'

import type { AnyElysia } from '../'
import type { Context } from '../context'
import { EventMap } from '../constants'
import type { CompiledHandler, InternalAppEvent, MaybePromise } from '../types'
import { WebStandardAdapter } from '../adapter/web-standard'

export function createBaseContext(app: AnyElysia) {
	class Decorator {}
	Object.assign(Decorator.prototype, {
		...app['~ext']?.decorator,
		store: app['~ext']?.store,
		redirect
	})

	return Decorator
}

export function createContext(
	app: AnyElysia
): new (request: Request) => Context {
	const headers = app['~ext']?.headers
		? Object.assign(
				Object.create(null),
				structuredClone(app['~ext'].headers)
			)
		: null

	return class Context extends createBaseContext(app) {
		params?: Record<string, string>
		headers?: Record<string, string>
		path: string
		set: { headers: Record<string, string> }

		constructor(public request: Request) {
			super()

			const url = request.url,
				s = url.indexOf('/', 11),
				qi = url.indexOf('?', s + 1)

			this.path = url.substring(s, qi !== -1 ? qi : undefined)
			this.set = {
				headers: headers ? Object.create(headers) : Object.create(null)
			}
		}
	} as any
}

export function getAsyncIndexes(onRequests: Function[]) {
	let asyncIndexes: number[] | undefined
	for (let i = 0; i < onRequests.length; i++)
		if (isAsyncFunction(onRequests[i])) {
			asyncIndexes ??= new Array(onRequests.length)
			asyncIndexes[i] = i
		}

	return asyncIndexes
}

const notFound = new Response('Not Found', { status: 404 })

function findRoute(
	context: Context,
	map: NonNullable<AnyElysia['~map']>,
	router: NonNullable<AnyElysia['~router']>,
	hasError: boolean
): Response {
	const handler: CompiledHandler = map[context.request.method]?.[context.path]
	if (handler) return handler(context) as Response

	const result = router.find(context.request.method, context.path)
	if (result) {
		context.params = result.params
		return result.store(context) as Response
	}

	if (hasError) throw new Error()

	return notFound.clone() as Response
}

export function createErrorHandler(
	onErrors: InternalAppEvent[EventMap['error']] | undefined,
	mapResponse: (
		response: unknown,
		set: Context['set'],
		...any: unknown[]
	) => unknown
) {
	const defaultError = new Response('Internal Server Error', { status: 500 })
	if (!onErrors) return () => defaultError.clone()

	const asyncIndexes = getAsyncIndexes(onErrors)
	if (!asyncIndexes)
		return (context: Context, error: Error) => {
			// @ts-expect-error
			context.error = error
			// @ts-expect-error
			context.code = error.code ?? 'UNKNOWN'

			for (let i = 0; i < onErrors.length; i++) {
				const error = onErrors[i](context)
				if (error !== undefined) return mapResponse(error, context.set)
			}

			return defaultError.clone() as Response
		}

	return async (context: Context, error: Error) => {
		// @ts-expect-error
		context.error = error
		// @ts-expect-error
		context.code = error.code ?? 'UNKNOWN'

		for (let i = 0; i < onErrors.length; i++) {
			const error = asyncIndexes?.[i]
				? await onErrors[i](context)
				: onErrors[i](context)

			if (error !== undefined) return mapResponse(error, context.set)
		}

		return defaultError.clone()
	}
}

export function createFetchHandler(
	app: AnyElysia
): (request: Request) => MaybePromise<Response> {
	const Context = createContext(app)
	const map = app['~map']!
	const router = app['~router']!

	const onErrors = app['~ext']?.event?.[EventMap.error]
	const hasError = !!onErrors
	const handleError = createErrorHandler(
		onErrors,
		(app['~config']?.adapter ?? WebStandardAdapter).response.map
	)

	if (app['~ext']?.event?.[EventMap.request]) {
		const onRequests = app['~ext'].event[EventMap.request]!
		const asyncIndexes = getAsyncIndexes(onRequests)

		if (asyncIndexes)
			return async (request: Request): Promise<Response> => {
				const context = new Context(request)

				try {
					for (let i = 0; i < onRequests.length; i++)
						if (asyncIndexes?.[i]) await onRequests[i](context)
						else onRequests[i](context)

					return findRoute(context, map, router, hasError)
				} catch (error) {
					return handleError(context, error as Error) as Response
				}
			}

		return (request: Request): Response => {
			const context = new Context(request)
			try {
				for (let i = 0; i < onRequests.length; i++)
					onRequests[i](context)

				return findRoute(context, map, router, hasError)
			} catch (error) {
				return handleError(context, error as Error) as Response
			}
		}
	}

	return (request: Request): Response => {
		const context = new Context(request)
		try {
			return findRoute(context, map, router, hasError)
		} catch (error) {
			return handleError(context, error as Error) as Response
		}
	}
}
