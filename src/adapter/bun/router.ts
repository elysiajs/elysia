// not used yet but might be in the future
import type { BunRequest } from 'bun'

import { MethodMapBack } from '../../constants'
import { createBaseContext } from '../../context'
import { getAsyncIndexes, createErrorHandler } from '../../handler'
import { flattenChain, nullObject } from '../../utils'

import { WebStandardAdapter } from '../web-standard'
import { NotFound } from '../../error'

import type { AnyElysia } from '../../base'
import type { Context } from '../../context'
import type { CompiledHandler, InternalRoute, MaybePromise } from '../../types'

export function createBunContext(
	app: AnyElysia
): new (request: Request) => Context {
	const headers = app['~ext']?.headers
		? Object.assign(nullObject(), app['~ext'].headers)
		: null

	return class Context extends createBaseContext(app) {
		params: Record<string, string>
		qi!: number
		headers?: Record<string, string>
		set: {
			headers: Record<string, string>
			status?: number | string
			cookie?: Record<string, unknown>
		}

		constructor(public request: BunRequest) {
			super()

			this.params = request.params
			this.set = {
				headers: Object.create(headers),
				status: undefined,
				cookie: undefined
			}
		}
	} as any
}

export function createFetchHandler(
	app: AnyElysia,
	Context: new (request: Request) => Context,
	handler: CompiledHandler,
	handleError: (context: Context, error: Error) => unknown
) {
	const hook = flattenChain(app['~hookChain'])
	if (hook?.request) {
		const onRequests = hook?.request
		const asyncIndexes = getAsyncIndexes(onRequests)

		if (asyncIndexes)
			return async (request: Request): Promise<Response> => {
				const context = new Context(request)

				try {
					for (let i = 0; i < onRequests.length; i++)
						if (asyncIndexes?.[i]) await onRequests[i](context)
						else onRequests[i](context)

					return handler(context)
				} catch (error) {
					return handleError(context, error as Error) as Response
				}
			}

		return (request: Request): MaybePromise<Response> => {
			const context = new Context(request)

			try {
				for (let i = 0; i < onRequests.length; i++)
					onRequests[i](context)

				return handler(context)
			} catch (error) {
				return handleError(context, error as Error) as Response
			}
		}
	}

	return createPlainHandler(handler, handleError, Context)
}

function createPlainHandler(
	handler: CompiledHandler,
	handleError: (context: Context, error: Error) => unknown,
	Context: new (request: Request) => Context
) {
	return function (request: Request) {
		const context = new Context(request)

		try {
			return handler(context)
		} catch (error) {
			return handleError(context, error as Error) as Response
		}
	}
}

export function createRouteMap(app: AnyElysia) {
	const Context = createBunContext(app)

	const handleError = createErrorHandler(
		flattenChain(app['~hookChain'])?.error,
		WebStandardAdapter.response.map,
		new Response('Not Found', { status: 404 }),
		app['~config']?.allowUnsafeValidationDetails
	)

	function fetch(request: Request) {
		return handleError(new Context(request), new NotFound()) as Response
	}

	const history = app.history
	const length = history?.length ?? 0

	if (length === 0)
		return [
			{
				'/elysia': new Response('hi')
			},
			fetch
		]

	const routes = nullObject()

	for (let i = 0; i < length; i++) {
		const route: InternalRoute = history![i]
		const method = route[0]
		const path = route[1]

		routes[path] ??= nullObject()
		routes[path][
			MethodMapBack[method as unknown as keyof MethodMapBack] ?? method
		] = createFetchHandler(
			app,
			Context,
			app.handler(i, false, route),
			handleError
		)
	}

	return [routes, fetch]
}
