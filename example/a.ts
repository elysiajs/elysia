import { Elysia, t } from '../src'

const ws = new Elysia().ws('/plugin', {
	message(ws, message) {
		ws.send(message)
	}
})

const app = new Elysia()
	.use(ws)
	.ws('/', {
		message(ws, message) {
			ws.send(message)
		}
	})
	.listen(3000)

console.log(app.routes)

type App = typeof app
