import { Elysia, t, SCHEMA, DEFS } from '../src'

const app = new Elysia()
	.setModel({
		a: t.Object({
			response: t.String()
		}),
		b: t.Object({
			response: t.Number()
		})
	})
	// Strictly validate response
	.get('/', () => 'hi')
	// Strictly validate body and response
	.post('/', ({ body, query }) => body.id, {
		schema: {
			body: t.Object({
				id: t.Number(),
				username: t.String(),
				profile: t.Object({
					name: t.String()
				})
			})
		}
	})
	// Strictly validate query, params, and body
	.get('/query/:id', ({ query: { name }, params }) => name, {
		schema: {
			query: t.Object({
				name: t.String()
			}),
			params: t.Object({
				id: t.String()
			}),
			response: {
				200: t.String(),
				300: t.Object({
					error: t.String()
				})
			}
		}
	})
	.guard(
		{
			schema: {
				query: 'a'
			}
		},
		(app) =>
			app
				.guard(
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
	.listen(8080)

type A = typeof app['meta'][typeof SCHEMA]['/']
type B = typeof app['meta'][typeof DEFS]

// const a = app.getModel('b')
