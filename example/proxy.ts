import { Elysia, t } from '../src'

const app = new Elysia({ precompile: true })
	.get('/', ({ query }) => {
		return query
	}, {
		query: t.Object({
			a: t.String()
		})
	})
	.all('/*', ({ request, params, query }) =>
		fetch({
			...request,
			url: `https://macosplay.com/${params['*']}?${new URLSearchParams(query)}`
		})
	)
	.listen(3000)

// console.log(app.routes[0].composed.toString())
