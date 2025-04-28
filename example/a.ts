import { Elysia, t } from '../src'

const a = (request: Request) => new Response(request.url)

let url = ''
let hasWrap = false

const app = new Elysia()
	.wrap((fn) => {
		console.log('A')

		return fn
	})
	.mount('/', () => new Response('OK'))
	.listen(3000)

fetch('http://localhost:3000/a')

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
