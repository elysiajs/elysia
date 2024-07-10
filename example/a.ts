import { Elysia, t } from '../src'
import { req } from '../test/utils'
import { AsyncLocalStorage } from 'async_hooks'

const store = new AsyncLocalStorage<{ i: number }>()

const outer = () => {
	const b = store.getStore()

	console.log({ b })
}

const app = new Elysia()
	.applyConfig({
		asyncLocalStorage: store
	})
	.onRequest(() => {
		const a = store.getStore()

		console.log({ a })

		if (a) a.i = 0
	})
	.get('/', async ({ query: { id } }) => {
		outer()

		return 'a'
	})

app.handle(req('/?id=1'))
// await Bun.sleep(100)
app.handle(req('/?id=2'))
