import { Elysia } from '../src'

const app = new Elysia()
	.get('/', async function* () {
		yield 'hello'
		await Bun.sleep(200)

		// yield 'hello'
		// await Bun.sleep(200)
	})
	.listen(3000)
