import { Elysia, sse } from '../src'

new Elysia()
	.get('/a', async function* () {
		for (let i = 0; i < 100; i++) {
			yield sse({
				event: 'message',
				data: 'A'
			})
			await Bun.sleep(100)
		}
	})
	.listen(3000)
