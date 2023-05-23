import { Elysia, ws } from '../src'

const app = new Elysia()
	.use(ws())
	.ws('/', {
		message(ws, message) {
			console.log(ws.data.headers)

			ws.send(message)
		}
	})
	.listen(3000)
