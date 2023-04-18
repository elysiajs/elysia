import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', () => 'A' as const, {
		schema: {
			response: {
				200: t.Literal('A'),
				400: t.Literal('B')
			}
		}
	})
	.listen(8080)
