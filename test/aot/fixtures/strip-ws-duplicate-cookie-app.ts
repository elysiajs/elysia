import { Elysia } from '../../../src'
import { websocket } from '../../../src/plugin/websocket'

// both WS routes under `/ws` build, the capture keeps the last one only
export const app = new Elysia()
	.use(websocket())
	.ws('/ws', {
		beforeHandle({ cookie, status }) {
			if (cookie.session?.value !== 'ok') return status(401)
		},
		message() {}
	})
	.ws('/ws', { message() {} })
