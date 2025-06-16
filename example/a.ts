import { Elysia, t } from '../src'

export const webSocketHandler = () => {
	return new Elysia().ws('/ws', {
		open(ws) {
			console.log('WebSocket connected')
		},
		message(ws, message) {}
	})
}

new Elysia().use(webSocketHandler).listen(3000)
