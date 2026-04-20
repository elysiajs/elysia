import type { BunRequest } from 'bun'

import { MethodMapBack } from '../../constants'
import { createBaseContext, getAsyncIndexes } from '../../handler/fetch'

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
		headers?: Record<string, string>
		set: { headers: Record<string, string> }

		constructor(public request: BunRequest) {
			super()

			this.params = request.params
			this.set = {
				headers: headers ? Object.create(headers) : Object.create(null)
			}
		}
	} as any
}

export function createFetchHandler(
	app: AnyElysia,
	Context: new (request: Request) => Context,
	handler: CompiledHandler
) {
	if (app['~ext']?.event?.request) {
		const onRequests = app['~ext']?.event?.request
		const asyncIndexes = getAsyncIndexes(onRequests)

		if (asyncIndexes)
			return async (request: Request): Promise<Response> => {
				const context = new Context(request)

				for (let i = 0; i < onRequests.length; i++)
					if (asyncIndexes?.[i]) await onRequests[i](context)
					else onRequests[i](context)

				return handler(context)
			}

		return (request: Request): MaybePromise<Response> => {
			const context = new Context(request)

			for (let i = 0; i < onRequests.length; i++) onRequests[i](context)

			return handler(context)
		}
	}

	return (request: Request) => handler(new Context(request) as any)
}

export function createRouteMap(app: AnyElysia) {
	const routes = Object.create(null)
	const Context = createBunContext(app)

	for (const path in app['~mapIdx']) {
		const methods = app['~mapIdx'][path]

		for (const method in methods) {
			routes[path] ??= Object.create(null)
			routes[path][
				MethodMapBack[method as unknown as keyof MethodMapBack] ??
					method
			] = createFetchHandler(app, Context, app.handler(methods[method]))
		}
	}

	return routes
}
