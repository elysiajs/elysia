import { Elysia } from '../../../src'
import { websocket } from '../../../src/plugin/websocket'

// No cookie schema: `ws/route` keeps cookie support because sucrose sees the
// upgrade hook read `cookie`, which the build never replays
export const app = new Elysia()
	.use(websocket())
	.ws('/ws', {
		beforeHandle({ cookie, status }) {
			if (cookie.session?.value !== 'ok') return status(401, 'no session')
		},
		message(ws, message) {
			ws.send(message)
		}
	})
	.get('/', () => 'ok')
