import { Elysia } from '../src'

const app = new Elysia()
	.onRequest(({ set }) => {
		set.headers['x-header'] = 'test'
		set.status = 400
		throw new Error("A")
	})
	.get('/', 'yay')
	.get('/func', () => 'yay')
	.listen(3000)
