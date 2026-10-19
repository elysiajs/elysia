import { Elysia, t } from '../src'

new Elysia()
	.state('name', 'salt')
	.get(
		'/',
		{
			query: t.Object({
				name: t.String()
			})
		},
		({ store: { name } }) => `Hi ${name}`
	)
	// If query 'name' is not preset, skip the whole handler
	.guard(
		{
			query: t.Object({
				name: t.String()
			})
		},
		(app) =>
			app
				// Query type is inherited from guard
				.get('/profile', ({ query }) => `Hi`)
				// Store is inherited
				.post(
					'/name',
					{
						body: t.Object({
							id: t.Number({
								minimum: 5
							}),
							username: t.String(),
							profile: t.Object({
								name: t.String()
							})
						})
					},
					({ store: { name }, body, query }) => name
				)
	)
	.listen(3000)
