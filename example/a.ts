import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true })
	.trace(({ onBeforeHandle }) => {
		onBeforeHandle(({ onEvent }) => {
			onEvent(({ onStop }) => {
				onStop(({ error }) => {
					console.log({ error })
					// if (error) isCalled = true
				})
			})
		})
	})
	.get('/', () => 'ok', {
		beforeHandle() {
			return new Error('A')
		}
	})
	// .listen(3000)

await app.handle(req('/'))

console.log(app.routes[0].composed?.toString())

app.handle(req('/'))

// const api = treaty(a)

// const { data, error, response } = await api.error.get()

// console.log(data, error, response)
