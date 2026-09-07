import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

describe('WebSocket connection', () => {
	it('should connect and close', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				message(ws, message) {
					ws.send(message)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('hello')
		expect((await message).data).toBe('hello')

		await wsClosed(ws)
		expect(ws.readyState).toBe(WebSocket.CLOSED)

		await app.stop(true)
	})
})
