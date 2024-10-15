import { Elysia } from '../src'
import { NodeAdapter } from '../src/adapter/node'

new Elysia({ adapter: NodeAdapter })
	.get('/', ({ cookie: { a, b } }) => {
		a.value = 'hi'
		b.value = 'hi'

		return 'hi'
	})
	.get('/stream', async function* () {
		for (let i = 0; i < 10; i++) {
			await new Promise((resolve) => setTimeout(resolve, 100))
			yield i
		}
	})
	.post('/', async ({ body, headers }) => {
		return {
			body,
			headers,
			env: typeof Bun !== 'undefined' ? 'bun' : 'likely Node'
		}
	})
	.listen(3000)
