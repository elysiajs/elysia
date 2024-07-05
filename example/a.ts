import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia()
	.trace(({ onBeforeHandle }) => {
		onBeforeHandle(({ onStop, onEvent }) => {
			onStop(({ error }) => {
				console.log(error)
			})
		})
	})
	.onBeforeHandle(({ error }) => {
		return error("I'm a teapot")
	})
	.get('/', () => 'hello')
	.listen(3000)

// await app.handle(req('/id/123'))
// await app.handle(req('/id/123'))
// await app.handle(req('/id/123'))
// const res = await app.handle(req('/id/123')).then((x) => x.text())

// console.log(app.routes[0].composed.toString())
