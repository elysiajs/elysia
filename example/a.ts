import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/', async () => {
		const file = Bun.file('test/kyuukurarin.mp4')

		// Wrap the stream in another ReadableStream
		// perhaps we are concatenating streams or whatever
		const body = new ReadableStream({
			async start(controller) {
				const reader = file.stream().getReader()
				try {
					while (true) {
						const { done, value } = await reader.read()
						if (done) break
						controller.enqueue(value)
					}
					controller.close()
				} catch (err) {
					controller.error(err)
				} finally {
					reader.releaseLock()
				}
			}
		})

		// Returning the stream uses 100% for several minutes
		return body

		// Returning the same stream wrapped in a Response servers the stream in a fraction of a second
		// return new Response(body);
	})
	.listen(3000)
