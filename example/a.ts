import { Elysia, sse, t } from '../src'
import { streamResponse } from '../src/adapter/utils'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/', function () {
		return new ReadableStream({
			async start(controller) {
				controller.enqueue('a')
				await Bun.sleep(100)
				controller.enqueue('b')
				await Bun.sleep(100)
				controller.close()
			}
		})
	})
	.listen(3000)

const response = await app.handle(req('/'))

for await (const a of streamResponse(response)) {
	console.log(a)
}
