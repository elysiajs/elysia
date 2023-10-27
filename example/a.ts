import { Elysia } from '../src'

const a = new Elysia({ name: 'p' }).trace(async ({ set, request }) => {
	await request
	console.log('A')
	// await request
	console.log('B')
})

const b = new Elysia({ scoped: true }).get('/scoped', () => 'hi')

const app = new Elysia()
	.onRequest(async () => {

	})
	.use(a)
	.use(b)
	.get('/', () => 'hi')
	.listen(3000)

// console.log(app.event)
// console.log(app.routes[0].composed?.toString())
