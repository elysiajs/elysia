import type { BunRequest } from 'bun'

import { MethodMapBack } from '../../constants'
import { createBaseContext } from '../../context'
import { getAsyncIndexes, createErrorHandler } from '../../handler'

import { WebStandardAdapter } from '../web-standard'
import { NotFound } from '../../error'

import type { AnyElysia } from '../..'
import type { Context } from '../../context'
import type { CompiledHandler, MaybePromise } from '../../types'

export function createBunContext(
	app: AnyElysia
): new (request: Request) => Context {
	const headers = app['~ext']?.headers
		? Object.assign(
				Object.create(null),
				structuredClone(app['~ext'].headers)
			)
		: null

	return class Context extends createBaseContext(app) {
		params: Record<string, string>
		qi!: number
		headers?: Record<string, string>
		set: { headers: Record<string, string> }

		constructor(public request: BunRequest) {
			super()

			this.params = request.params
			this.set = {
				headers: Object.create(headers)
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
	const hook = app['~ext']?.hooks?.at(-1)
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

	return (request: Request) => {
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

	function fetch(request: Request) {
		return handleError(new Context(request), new NotFound()) as Response
	}

	if (!app['~mapIdx'])
		return [
			{
				'/_elysia': { GET: new Response('hi') }
			},
			fetch
		]

	const routes = Object.create(null)

	const handleError = createErrorHandler(
		app['~ext']?.hooks?.at(-1)?.error,
		WebStandardAdapter.response.map,
		new Response('Not Found', { status: 404 })
	)

	for (const method in app['~mapIdx']) {
		const paths = app['~mapIdx'][method]

		for (const path in paths) {
			routes[path] ??= Object.create(null)
			routes[path][
				MethodMapBack[method as unknown as keyof MethodMapBack] ??
					method
			] = createFetchHandler(
				app,
				Context,
				app.handler(paths[path], false, undefined),
				handleError
			)
		}
	}

	return [routes, fetch]
}
