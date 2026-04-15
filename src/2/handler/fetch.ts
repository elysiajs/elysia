import type { AnyElysia } from '../'
import { CompiledHandler } from '../types'
import { redirect } from '../utils'

export function createFetchHandler(
	app: AnyElysia
): (request: Request) => Promise<Response> {
	const headers = app['~headers']

	class Decorator {}
	Object.assign(Decorator.prototype, {
		...app.decorator,
		store: app.store,
		redirect
	})

	class Context extends Decorator {
		set = {
			headers: headers || Object.create(null)
		}

		constructor(public request: Request) {
			super()
		}
	}

	const map = app['~routeMap']!
	const router = app['~router']

	return (request: Request) => {
		const url = request.url,
			s = url.indexOf('/', 11),
			qi = url.indexOf('?', s + 1),
			path = url.substring(s, qi !== -1 ? qi : undefined)

		const context = new Context(request)

		const handler: CompiledHandler = map[request.method]?.[path]
		if (handler) return handler(context)

		if (router) {
			const result = router.find(request.method, path)
			if (result) {
				// @ts-expect-error
				context.params = result.params
				return result.store(context)
			}
		}

		return new Response('Not Found', { status: 404 })
	}
}
