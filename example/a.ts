import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia()
	.model({
		res: t.String()
	})
	.get('/correct', () => 'Hello Elysia', { response: 'res' })
	// @ts-expect-error
	.get('/error', () => 1, { response: 'res' })

const error = await app.handle(req('/error'))
// const correct = await app.handle(req('/correct'))

// console.log(app.routes[0].compile().toString())

// app.handle(
// 	new Request('http://localhost', {
// 		method: 'POST',
// 		headers: {
// 			'Content-Type': 'application/json'
// 		},
// 		body: JSON.stringify({ a: { a: { a: 'cool' } } })
// 	})
// )
// 	.then((x) => x.json())
// 	.then(console.log)
