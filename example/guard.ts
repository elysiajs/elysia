import { Elysia, t } from '../src'

new Elysia()
	.state('name', 'salt')
	.get('/', ({ store: { name } }) => `Hi ${name}`, {
		query: t.Object({
			name: t.String()
		})
	})
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
				.post('/name', ({ store: { name }, body, query }) => name, {
					body: t.Object({
						id: t.Number({
							minimum: 5
						}),
						username: t.String(),
						profile: t.Object({
							name: t.String()
						})
					})
				})
	)
	.listen(3000)
