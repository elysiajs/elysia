import { Elysia } from '../src'

const app = new Elysia()
	.trace(({ id }) => {
		// console.log(id)
	})
	.get('/', ({ set }) => 'A', {})
	.listen(8080)
