import { Elysia } from '../src'

const app = new Elysia()
	.trace(async ({ handle, set }) => {
		const { time: start, process } = await handle
		const { time: end } = await process

		set.headers['Server-Timing'] = `handle;dur=${end - start}`
	})
	.get('/', async () => {
		// Delay for 100ms
		await new Promise((r) => setTimeout(r, 100))

		return 'Done'
	})
	.listen(8080)
