import { Elysia, t } from '../src'

new Elysia()
	.setStore('name', 'salt')
	.get('/', ({ store: { name } }) => `Hi ${name}`, {
		schema: {
			query: t.Object({
				name: t.String()
			})
		}
	})
	// If query 'name' is not preset, skip the whole handler
	.guard(
		{
			schema: {
				query: t.Object({
					name: t.String()
				})
			}
		},
		(app) =>
			app
				// Query type is inherited from guard
				.get('/profile', ({ query }) => `Hi`)
				// Store is inherited
				.post('/name', ({ store: { name }, body, query }) => name, {
					schema: {
						body: t.Object({
							id: t.Number().min(5),
							username: t.String(),
							profile: t.Object({
								name: t.String()
							})
						})
					}
				})
	)
	.listen(8080)
