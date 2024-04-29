import { Elysia, t } from '../src'

const app = new Elysia()
	.model({
		name: t.Object({
			name: t.String()
		}),
		b: t.Object({
			response: t.Number()
		}),
		authorization: t.Object({
			authorization: t.String()
		})
	})
	// Strictly validate response
	.get('/', () => 'hi')
	// Strictly validate body and response
	.post('/', ({ body, query }) => body.id, {
		body: t.Object({
			id: t.Number(),
			username: t.String(),
			profile: t.Object({
				name: t.String()
			})
		})
	})
	// Strictly validate query, params, and body
	.get('/query/:id', ({ query: { name }, params }) => name, {
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
	})
	.guard(
		{
			headers: 'authorization'
		},
		(app) =>
			app
				.derive(({ headers }) => ({
					userId: headers.authorization
				}))
				.get('/', ({ userId }) => 'A')
				.post('/id/:id', ({ query, body, params, userId }) => body, {
					params: t.Object({
						id: t.Number()
					}),
					transform({ params }) {
						params.id = +params.id
					}
				})
	)
	.listen(3000)
