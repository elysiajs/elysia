import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', 'hi')
	.post('/', ({ body }) => body, {
		type: 'json'
	})
	.get('/id/:id', ({ params: { id }, query: { a: c, b } }) => ({
		c,
		b
	}))
	.listen(3000)

console.log(
	await app
		.handle(new Request('http://localhost/id/1?a=abc&b=bcd'))
		.then((x) => x.json())
)

console.log(app.routes[1].composed?.toString())
