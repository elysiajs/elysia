import { Elysia } from '../../../src'
import { websocket } from '../../../src/plugin/websocket'

// WebSocket routes retain their runtime while the captured HTTP route permits
// automatic stripping of the handler compiler.
export const app = new Elysia()
	.use(websocket())
	.get('/', () => 'ok')
	.ws('/ws', { message: () => {} })
