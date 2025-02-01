import { Elysia } from '../src'

const app = new Elysia()
	.ws('/ws/:id', {
		message(ws, message) {
			ws.send(message)
		}
	})
	// .get('/ws/:id', () => 'hi')
	.listen(3000)

// console.log(app.fetch.toString())
