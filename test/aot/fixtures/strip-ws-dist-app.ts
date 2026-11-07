import { Elysia } from 'elysia'
import { websocket } from 'elysia/websocket'

// The bare imports resolve to dist, where `ws/route` imports `hasSyncHmac`
// straight from `cookie/crypto` instead of through `cookie/utils`
export const app = new Elysia()
	.use(websocket())
	.ws('/echo', {
		message(ws, message) {
			ws.send(message)
		}
	})
	.get('/', () => 'hi')
