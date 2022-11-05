import { KingWorld, t } from '../src'
// import { Type as t } from '@sinclair/typebox'

const app = new KingWorld()
	// Strictly validate response
	.get('/', () => 'hi', {
		schema: {
			response: t.String()
		}
	})
	// Strictly validate body and response
	.post('/', ({ body }) => body.id, {
		schema: {
			body: t.Object({
				id: t.Number(),
				username: t.String(),
				profile: t.Object({
					name: t.String()
				})
			}),
			response: t.Number()
		}
	})
	// Strictly validate query, params, and body
	.get('/query/:id', ({ query: { name } }) => name, {
		schema: {
			query: t.Object({
				name: t.String()
			}),
			params: t.Object({
				id: t.String()
			})
		}
	})
	.guard(
		{
			schema: {
				query: t.Object({
					name: t.String()
				})
			}
		},
		(app) =>
			app.guard(
				{
					schema: {
						body: t.Object({
							username: t.String()
						})
					}
				},
				(app) =>
					app.post('/id/:id', ({ query, body, params }) => body, {
						schema: {
							params: t.Object({
								id: t.Number()
							})
						},
						transform: ({ params }) => {
							params.id = +params.id
						}
					})
			)
	)
	.listen(3000)
