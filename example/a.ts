import { Elysia, MaybeArray, status, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.macro({
		a: {
			query: t.Object({
				name: t.Literal('lilith')
			}),
			cookie: t.Object({
				name: t.Literal('lilith')
			}),
			params: t.Object({
				name: t.Literal('lilith')
			}),
			body: t.Object({
				name: t.Literal('lilith')
			}),
			headers: t.Object({
				name: t.Literal('lilith')
			}),
			response: {
				403: t.Object({
					name: t.Literal('lilith')
				})
			}
		}
	})
	.post('/', ({ body }) => 'b' as const, {
		a: true
	})

app['~Routes']['post']
