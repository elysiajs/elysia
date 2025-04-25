import { Elysia, t } from '../src'

const app = new Elysia().post('/', (body) => body).listen(3000)

app.handle(
	new Request('http://localhost/', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ hello: 'world' })
	})
).then((x) => x.json())

console.log(app.routes[0].compile().toString())
