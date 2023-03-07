import { Elysia, t, ws } from '../src'

const app = new Elysia()
	.use(ws())
	.state('start', 'here')
	.ws('/ws', {
		open(ws) {
			ws.subscribe('asdf')
		},
		message(ws, message) {
			ws.publish('asdf', message)
		}
	})
	.get('/publish/:publish', ({ publish, params: { publish: text } }) => {
		app.server!.publish('asdf', text)

		return text
	})
	.listen(8080, (server) => {
		console.log(`http://${server.hostname}:${server.port}`)
	})
