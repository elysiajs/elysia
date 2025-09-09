import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

new Elysia()
	.macro('a', {
		body: t.Object({ a: t.Literal('A') }),
		beforeHandle({ body }) {
		}
	})
	.macro('b', {
		a: true,
		body: t.Object({ b: t.Literal('B') }),
		beforeHandle({ body }) {
		}
	})

const app = new Elysia()
	.macro({
		sartre: {
			params: t.Object({ sartre: t.Literal('Sartre') })
		},
		focou: {
			query: t.Object({ focou: t.Literal('Focou') })
		},
		lilith: {
			body: t.Object({ lilith: t.Literal('Lilith') })
		}
	})
	.macro('a', {
		body: t.Object({ a: t.Literal('A') }),
		beforeHandle({ body }) {}
	})
	.post('/:sartre', ({ body }) => body, {
		a: true,
		sartre: true,
		focou: true,
		lilith: true
	})

const response = await app
	.handle(
		post('/Sartre', {
			lilith: 'Lilith'
		})
	)
	.then((x) => x.json())
	.then(console.log)

// console.log(app.routes[0].compile().toString())

// console.log(app.routes[0].hooks)
