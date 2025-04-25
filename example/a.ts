import { Elysia, t } from '../src'

const app = new Elysia()
	.post('/', ({ query: { a } }) => a, {
		query: t.Object({
			a: t.String()
		})
	})
	.listen(3000)

app.handle(
	new Request('http://localhost/', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ hello: 'world' })
	})
).then((x) => x.json())

console.log(app.fetch.toString())
