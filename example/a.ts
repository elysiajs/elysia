import { Elysia, t } from '../src'
import z from 'zod'

const app = new Elysia()
	.get('/', () => 'Hello Elysia')
	.ws('/typebox', {
		body: t.Object({
			type: t.Literal('test-one'),
			message: t.String()
		}),
		open(ws) {
			console.log('Connection opened')
		},
		message(ws, message) {
			console.log('Received message:', message)
			ws.send(`Echo: ${JSON.stringify(message)}`)
		},
		close(ws) {
			console.log('Connection closed')
		}
	})
	.ws('/zod', {
		body: z.object({
			type: z.literal('test-one'),
			message: z.string()
		}),
		open(ws) {
			console.log('Connection opened')
		},
		message(ws, message) {
			console.log('Received message:', message)
			ws.send(`Echo: ${JSON.stringify(message)}`)
		},
		close(ws) {
			console.log('Connection closed')
		}
	})
	.listen(3000)

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
