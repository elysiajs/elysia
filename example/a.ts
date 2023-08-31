import { Elysia } from '../src'

const app = new Elysia()
	.get('/', () => {
		throw new Error('AWD')
	})
	.onResponse((context) => {
		console.log(context)
	})
	.onError(({ set }) => {
		return new Response('a', {
			status: 401,
			headers: {
				awd: 'b'
			}
		})
	})
	.listen(8080)
