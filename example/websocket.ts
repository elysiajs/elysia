import { Elysia } from '../src'

const app = new Elysia()
	.state('start', 'here')
	.ws('/ws', {
		open(ws) {
			ws.subscribe('asdf')
			console.log('Open Connection:', ws.id)
		},
		close(ws) {
			console.log('Closed Connection:', ws.id)
		},
		message(ws, message) {
			ws.publish('asdf', message)
			ws.send('asdf', message)
		}
	})
	.get('/publish/:publish', ({ params: { publish: text } }) => {
		app.server!.publish('asdf', text)

		return text
	})
	.listen(3000, (server) => {
		console.log(`http://${server.hostname}:${server.port}`)
	})
