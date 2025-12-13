import { Elysia } from '../src'

const app = new Elysia()
	.get('/fail', () => {
		throw new Error('oops')
	})
	.compile()
	.listen(8787)
