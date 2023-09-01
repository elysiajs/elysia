import { Elysia } from '../src'

const app = new Elysia()
	.get('/', () => {
		throw new Error('Error')
	})
	.listen(8080)
