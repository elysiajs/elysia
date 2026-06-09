import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { newWebsocket, wsOpen, wsClosed, wsMessage } from './utils'

describe('WebSocket destructuring', () => {
	it('should destructure', async () => {
		const app = new Elysia()
			.ws('/ws', {
				async open(ws) {
					const {
						subscribe,
						isSubscribed,
						publish,
						unsubscribe,
						cork,
						send,
						// close,
						// terminate
					} = ws

					subscribe('asdf')
					const subscribed = isSubscribed('asdf')
					publish('asdf', 'data')
					unsubscribe('asdf')
					cork(() => ws)
					send('Hello!' + subscribed)
					// malloc error on macOS
					// close()
					// terminate()
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		const message = wsMessage(ws)

		await wsOpen(ws)

		const { type, data } = await message

		expect(type).toBe('message')
		expect(data).toBe('Hello!true')

		await wsClosed(ws)
		app.stop()
	})
})
