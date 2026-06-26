import { Elysia, t } from '../src'
import { compileFetch } from '../src/compile/fetch'
import { createFetchHandler } from '../src/handler'
import { Validator } from '../src/validator'

const app = new Elysia()
	.get('/', () => 'ok')
	.get('/user/:id', ({ params: { id } }) => id)
	.post(
		'/json',
		{
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ body }) => body
	)
	.post(
		'/json-default',
		{
			body: t.Object({
				name: t.String({ default: 'saltyaom' }),
				tags: t.Array(t.String(), { default: ['elysia'] })
			})
		},
		({ body }) => body
	)
	.get(
		'/search',
		{
			query: t.Object({ page: t.Number(), limit: t.Number() })
		},
		({ query }) => query
	)
	.get(
		'/me',
		{
			cookie: t.Object({ session: t.Optional(t.String()) })
		},
		({ cookie: { session } }) => session.value
	)

console.log(app.fetch.toString())

const a = app.fetch(new Request('http://localhost/'))
