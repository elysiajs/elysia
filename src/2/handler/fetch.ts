import { redirect } from '../utils'

import type { AnyElysia } from '../'
import type { Context } from '../context'
import type { CompiledHandler, MaybePromise } from '../types'
import { isAsyncFunction } from '../compile/utils'

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
	router: NonNullable<AnyElysia['~router']>
): Response {
	const handler: CompiledHandler = map[context.request.method]?.[context.path]
	if (handler) return handler(context) as Response

	const result = router.find(context.request.method, context.path)
	if (result) {
		context.params = result.params
		return result.store(context) as Response
	}

	return notFound.clone() as Response
}

export function createFetchHandler(
	app: AnyElysia
): (request: Request) => MaybePromise<Response> {
	const Context = createContext(app)
	const map = app['~map']!
	const router = app['~router']!

	if (app['~ext']?.event?.request) {
		const onRequests = app['~ext'].event.request
		const asyncIndexes = getAsyncIndexes(onRequests)

		if (asyncIndexes)
			return async (request: Request): Promise<Response> => {
				const context = new Context(request)

				for (let i = 0; i < onRequests.length; i++)
					if (asyncIndexes?.[i]) await onRequests[i](context)
					else onRequests[i](context)

				return findRoute(context, map, router)
			}

		return (request: Request): Response => {
			const context = new Context(request)

			for (let i = 0; i < onRequests.length; i++) onRequests[i](context)

			return findRoute(context, map, router)
		}
	}

	return (request: Request): Response =>
		findRoute(new Context(request), map, router)
}
