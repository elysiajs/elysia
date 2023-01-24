import { Elysia, SCHEMA, t } from '../src'

const app = new Elysia()
	.get('/', () => 'Elysia')
	.post('/', () => 'Elysia')
	.get('/id/:id', () => 1)
	.post('/mirror', ({ body }) => body, {
		schema: {
			query: t.Object({
				n: t.String()
			}),
			body: t.Object({
				username: t.String(),
				password: t.String()
			})
		}
	})
	.get('/sign-in', ({ body }) => 'ok')
	.get('/products/nendoroid/skadi', ({ body }) => 1)
	.get('/id2/:id', ({ params }) => 1, {
		schema: {
			detail: {
				'summary': 'a',
			}
		}
	})

type App = typeof app['store'][typeof SCHEMA]['/mirror']['POST']['body']