import { describe, it } from 'bun:test'
import { Elysia } from '../../src'
import { newWebsocket, wsOpen, wsClosed } from './utils'

describe('WebSocket with AoT disabled', () => {
	it('should connect and close', async () => {
		const app = new Elysia({ aot: false })
			.ws('/ws', {
				message() {}
			})
			.listen(0)

		// @ts-expect-error some properties are missing
		const ws = newWebsocket(app.server!)

		await wsOpen(ws)
		await wsClosed(ws)

		await app.stop()
	})
})
