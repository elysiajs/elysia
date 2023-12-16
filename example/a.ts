import { Elysia, t } from '../src'
import { req } from '../test/utils'

const delay = (time = 1000) => new Promise((r) => setTimeout(r, time))

const app = new Elysia()
	.trace(async ({ beforeHandle, handle, afterHandle, set }) => {
		await beforeHandle
		await handle
		await afterHandle

		set
	})
	.get('/', () => 'A', {
		beforeHandle() {
			return 'a'
		},
		afterHandle() {}
	})
	.get('static', Bun.file('test/kyuukurarin.mp4'))
	.listen(3000)
