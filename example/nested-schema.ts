import { Elysia, t } from '../src'

new Elysia()
	.guard(
		{
			query: t.Object({
				name: t.String()
			})
		},
		(app) =>
			app
				.get('/', ({ query }) => 'A', {
					beforeHandle: ({ query }) => {},
					query: t.Object({
						a: t.String()
					})
				})
				.guard(
					{
						headers: t.Object({
							a: t.String()
						})
					},
					(app) =>
						app.get('/a', () => 'A', {
							beforeHandle: ({ query }) => {},
							body: t.Object({
								username: t.String()
							})
						})
				)
	)
	.get('*', () => 'Star now work')
	.listen(3000)
