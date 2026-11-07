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
				.get(
					'/',
					{
						beforeHandle: ({ query }) => {},
						query: t.Object({
							a: t.String()
						})
					},
					({ query }) => 'A'
				)
				.guard(
					{
						headers: t.Object({
							a: t.String()
						})
					},
					(app) =>
						app.get(
							'/a',
							{
								beforeHandle: ({ query }) => {},
								body: t.Object({
									username: t.String()
								})
							},
							() => 'A'
						)
				)
	)
	.get('*', () => 'Star now work')
	.listen(3000)
