import { Elysia } from '../src'

new Elysia()
	.all('/*', ({ request, params }) =>
		fetch({
			...request,
			url: `https://hono.dev/${params['*']}`
		})
	)
	.listen(3000)
