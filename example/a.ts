import { Elysia, t } from '../src'
import { req } from '../test/utils'

let isAfterResponseCalled = false

const app = new Elysia()
	.onAfterResponse(() => {
		isAfterResponseCalled = true
		console.log('B')
	})
	.onError(() => {
		return new Response('a', {
			status: 401,
			headers: {
				awd: 'b'
			}
		})
	})
	.listen(3000)

await app.handle(req('/'))
await Bun.sleep(1)

console.log(isAfterResponseCalled)
