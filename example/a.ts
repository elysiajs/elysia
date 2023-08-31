import { Elysia, t } from '../src'

const app = new Elysia()
	.ws('/', {
		message(ws, message) {
			ws.send(message)
		}
	})
	.listen(8080)
