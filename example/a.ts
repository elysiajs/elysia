import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', () => 'Hi')
	.get('/a', () => 'Hi')
	.post('/hello', () => 'Hello')
	// .onError(({ code }) => {
	// 	console.log(code)

	// 	if (code === 'NOT_FOUND')
	// 		return new Response("I'm a teapot", {
	// 			status: 418
	// 		})
	// })
	.listen(3000, ({ hostname, port }) => {
		console.log(`Running at http://${hostname}:${port}`)
	})
