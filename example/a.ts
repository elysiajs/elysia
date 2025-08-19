import { Elysia, t } from '../src'
import { req } from '../test/utils'

let isAfterResponseCalled = false

const app = new Elysia({ precompile: true })
	.onAfterResponse(() => {
		isAfterResponseCalled = true
	})
	.onError(() => {
		return new Response('a', {
			status: 401,
			headers: {
				awd: 'b'
			}
		})
	})
	.compile()

// console.log(app.handleError.toString())

await app.handle(req('/'))
// wait for next tick
await Bun.sleep(1)

console.log(isAfterResponseCalled)
