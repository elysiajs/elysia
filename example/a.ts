import { Elysia, sse, t } from '../src'

const message = t.Object({
	event: t.String(),
	data: t.Object({
		message: t.String(),
		timestamp: t.String()
	})
})
type message = typeof message.static

const app = new Elysia()
	.get(
		'/sse',
		function* () {
			// <-- Here's the problem
			yield sse({
				event: 'message',
				data: {
					message: 'This is a message',
					timestamp: new Date().toISOString()
				}
			})
		},
		{
			response: {
				200: message // <-- If I remove this, the error goes away, but I have no openapi documentation for this endpoint
			}
		}
	)
	.listen(3000)

// console.log(app.routes[0].compile().toString())
