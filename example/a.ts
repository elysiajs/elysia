import { Elysia, t } from '../src'

const a = (request: Request) => new Response(request.url)

const app = new Elysia({ systemRouter: false })
	.trace((a) => {
		a.onHandle(() => {
			// @ts-expect-error private property
			a.context.url
		})
	})
	.get('/', () => 'ok')
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
