import { Elysia } from 'elysia'
import { websocket } from 'elysia/websocket'
import { trace } from 'elysia/trace'

export const traced: string[] = []

// No HTTP route, so no handler links `tr`: only the fetch handler traces
export const app = new Elysia()
	.use(websocket())
	.use(trace())
	.trace(({ onRequest, context }) => {
		onRequest(() => {
			traced.push(new URL(context.request.url).pathname)
		})
	})
	.ws('/echo', {
		message(ws, message) {
			ws.send(message)
		}
	})
