import { Elysia } from '../src'

new Elysia()
	.all('/*', ({ request, params, query }) =>
		fetch({
			...request,
			url: `https://macosplay.com/${params['*']}?${new URLSearchParams(query)}`
		})
	)
	.listen(3000)
