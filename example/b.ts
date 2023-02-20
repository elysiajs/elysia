import { Elysia, t, DEFS, SCHEMA } from '../src'

const app = new Elysia()
	.get('/', () => {})
	.get('/a', () => 'hi', {
		schema: {
			response: {
				200: t.String(),
				418: t.Object({
					name: t.Literal("I'm a teapot")
				})
			}
		}
	})

type A = typeof app['store'][typeof SCHEMA]['/a']