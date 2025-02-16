import { Elysia } from '../src'

const app = new Elysia({ precompile: true })
	.post('/json', ({ body }) => body, {
		parse: 'json'
	})
	.listen(3000)

console.log(app.routes[0].composed.toString())

const response = await app
	.handle(
		new Request('http://localhost:3000/json', {
			method: 'POST',
			body: JSON.stringify({ name: 'Aru' })
		})
	)
	.then((x) => x.json())


// console.log(app.fetch.toString())
