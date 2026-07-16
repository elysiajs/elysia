import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

describe('WebSocket message arguments', () => {
	it('delivers the body to a default parameter regardless of function length', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws, message = 'DEFAULT') {
					ws.send(String(message))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('real-body')

		expect((await message).data).toBe('real-body')

		await wsClosed(ws)
		app.stop()
	})

	it('delivers the body through rest parameters regardless of function length', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws, ...args: unknown[]) {
					ws.send(String(args[0]))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('rest-body')

		expect((await message).data).toBe('rest-body')

		await wsClosed(ws)
		app.stop()
	})
})
