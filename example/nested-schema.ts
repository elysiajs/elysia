import { KingWorld, t } from '../src'

new KingWorld()
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
				.get('/', ({ query, body }) => 'A', {
					beforeHandle: ({ query, body }) => {},
					schema: {
						query: t.Object({
							a: t.String()
						})
					}
				})
				.guard(
					{
						schema: {
							header: t.Object({
								a: t.Number()
							})
						}
					},
					(app) =>
						app.get('/a', () => 'A', {
							beforeHandle: ({ query }) => {},
							schema: {
								body: t.Object({
									username: t.String()
								})
							}
						})
				)
	)
	.get('*', () => 'Star now work')
	.listen(3000)
