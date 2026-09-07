import { Elysia, t } from '../src'

new Elysia()
	.wrap((fn) => async (request) => {
		const response = await fn(request)

		console.log({ request, response })

		return response
	})
