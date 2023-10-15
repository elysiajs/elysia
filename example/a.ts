import { Elysia, t } from '../src'

const T = t.Union([t.Literal('order'), t.Literal('artists')])

const app = new Elysia()
	.onBeforeHandle(({ headers }) => {
		console.log(headers)
	})
	.all('/v3/:id', (ctx) => {
		return 'Hello from http'
	})
	.ws('/v3/:id', {
		message(ws, message) {
			ws.send('pong')
		}
	})
	.listen(3000)

console.log(app.fetch.toString())