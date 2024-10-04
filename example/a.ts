import { Elysia } from '../src'

const app = new Elysia()
	.post('/', (context) => {
		// context.b
	}, {
		derive: () => { return { b: 'b' } }
		// resolve: () => ({ resolved: 'a' })
	})
	.listen(3000)
