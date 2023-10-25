import { Elysia } from '../src'

const a = new Elysia()
	.trace(async ({ set, request }) => {
		console.log("A")
		// await request
		console.log("B")
	})

const app = new Elysia()
	.use(a)
	// .trace(async ({ set, request }) => {
	// 	console.log("A")
	// 	// await request
	// 	console.log("B")
	// })
	.get('/', () => {
		console.log("A")

		return 'hi'
	})
	.listen(3000)

console.log(app.routes[0].composed?.toString())