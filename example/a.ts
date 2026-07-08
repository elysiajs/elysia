import { Elysia, file } from '../src'

export const app = new Elysia()
	.trace(() => {})
	.headers({
		'x-powered-by': 'elysia'
	})
	.post('/', async function* () {
		await Bun.sleep(1000)
		yield 1
		await Bun.sleep(100)
		yield 1
	})
	.listen(3000)
