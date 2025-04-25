import { Elysia, t } from '../src'

const app = new Elysia({ precompile: true })
	.post('/', (c) => c.body, {
		parse: 'json'
	})
	.listen(3000)

Bun.serve({
	port: 3001,
	routes: {
		'/': async (request) =>
			new Response(JSON.stringify(await request.json()), {
				headers: {
					'content-type': 'application/json'
				}
			})
	}
})

console.log(app.routes[0].compile().toString())

// app.handle(
// 	new Request('http://localhost/', {
// 		method: 'POST',
// 		headers: {
// 			'Content-Type': 'application/json'
// 		},
// 		body: JSON.stringify({ hello: 'world' })
// 	})
// ).then((x) => x.json())

// console.log(app.fetch.toString())
// console.log(app.routes[0].compile().toString())
