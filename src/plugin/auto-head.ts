import type { AnyElysia } from '../base'
import type { InternalRoute } from '../types'

function toHeadResponse(response: Response) {
	if (!(response instanceof Response) || response.body === null)
		return response

	response.body.cancel?.().catch(() => {})

	return new Response(null, {
		status: response.status,
		headers: response.headers
	})
}

export const autoHead =
	() =>
	async <App extends AnyElysia>(app: App): Promise<void> => {
		await Promise.resolve()

		app.wrap((handle) => (request, ...rest) => {
			const response = handle(request, ...rest)
			if (request.method !== 'HEAD') return response

			return response instanceof Promise
				? response.then(toHeadResponse)
				: toHeadResponse(response)
		})

		const routes = app['~routes']
		const explicitHead = new Set<string>()

		for (let i = 0; i < routes.length; i++)
			if (routes[i][0] === 'HEAD') explicitHead.add(routes[i][1])

		for (let i = 0; i < routes.length; i++) {
			const route = routes[i]
			if (route[0] === 'GET' && !explicitHead.has(route[1]))
				app['~addRoute'](
					['HEAD', ...route.slice(1)] as unknown as InternalRoute
				)
		}
	}
