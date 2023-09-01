import { Elysia } from '../src'

const app = new Elysia()
	.onTrace(({ onRequest }) => {
		onRequest(async ({ handle, response, afterHandle }) => {
			const { process: handler, time } = await handle

			const a = await afterHandle

			console.log('handler took', (await handler).time - time)
		})
	})
	.get('/', () => {
		throw new Error("Error")
	})
	.listen(8080)
