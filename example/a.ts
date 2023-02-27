import { Elysia, t, SCHEMA } from '../src'

const app = new Elysia()
	.setModel({
		a: t.Number()
	})
	.post('/c', ({ store }) => 1, {
		schema: {
			response: 'a'
		}
	})
	.listen(8080)

type App = typeof app['meta'][typeof SCHEMA]['/c']['POST']
