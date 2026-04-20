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
				structuredClone(app['~ext']?.headers)
			)
		: undefined

	return class Context extends createBaseContext(app) {
		params: Record<string, string>
		headers?: Record<string, string>
		set = {
			headers: headers ? Object.create(headers) : Object.create(null)
		}

		constructor(public request: BunRequest) {
			super()

			this.params = request.params
		}
	} as any
}

export function createFetchHandler(app: AnyElysia, handler: CompiledHandler) {
	const Context = createBunContext(app)

	if (app['~evt']?.request) {
		const onRequests = app['~evt'].request
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

	for (const path in app['~mapIdx']) {
		const methods = app['~mapIdx'][path]

		for (const method in methods) {
			routes[path] ??= Object.create(null)
			routes[path][
				MethodMapBack[method as unknown as keyof MethodMapBack] ??
					method
			] = createFetchHandler(app, app.handler(methods[method]))
		}
	}

	return routes
}
