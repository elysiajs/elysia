import { Elysia } from '../../../src'

// WebSocket routes retain their runtime while the captured HTTP route permits
// automatic stripping of the handler compiler.
export const app = new Elysia()
	.get('/', () => 'ok')
	.ws('/ws', { message: () => {} })
