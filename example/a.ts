import { Elysia, t } from '../src'

const app = new Elysia().mount(async (request) => {
	// const body = await request.json()
	// console.log({ body })
	return new Response("OK")
})

app.handle(
	new Request('http://localhost', {
		method: 'GET',
		// headers: {
		// 	'Content-Type': 'application/json'
		// },
		// body: JSON.stringify({ hello: 'world' })
	})
)
	.then((x) => x.text())
	.then(console.log)
