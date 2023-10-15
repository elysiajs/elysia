import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

describe('WebSocket message', () => {
	it('should send & receive', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws, message) {
					ws.send(message)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send('Hello!')

		const { type, data } = await message

		expect(type).toBe('message')
		expect(data).toBe('Hello!')

		await wsClosed(ws)
		app.stop()
	})

	it('should respond with remoteAddress', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws) {
					ws.send(ws.remoteAddress)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send('Hello!')

		const { type, data } = await message

		expect(type).toBe('message')
		expect(data === '::1' || data === '::ffff:127.0.0.1').toBeTruthy()

		await wsClosed(ws)
		app.stop()
	})

	it('should subscribe & publish', async () => {
		const app = new Elysia()
			.ws('/ws', {
				open(ws) {
					ws.subscribe('asdf')
				},
				message(ws) {
					ws.publish('asdf', ws.isSubscribed('asdf'))
				}
			})
			.listen(0)

		const wsBob = newWebsocket(app.server!)
		const wsAlice = newWebsocket(app.server!)

		await wsOpen(wsBob)
		await wsOpen(wsAlice)

		const messageBob = wsMessage(wsBob)

		wsAlice.send('Hello!')

		const { type, data } = await messageBob

		expect(type).toBe('message')
		expect(data).toBe('true')

		await wsClosed(wsBob)
		await wsClosed(wsAlice)
		app.stop()
	})

	it('should unsubscribe', async () => {
		const app = new Elysia()
			.ws('/ws', {
				open(ws) {
					ws.subscribe('asdf')
				},
				message(ws, message) {
					if (message === 'unsubscribe') {
						ws.unsubscribe('asdf')
					}

					ws.send(ws.isSubscribed('asdf'))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const subscribedMessage = wsMessage(ws)

		ws.send('Hello!')

		const subscribed = await subscribedMessage

		expect(subscribed.type).toBe('message')
		expect(subscribed.data).toBe('true')

		const unsubscribedMessage = wsMessage(ws)

		ws.send('unsubscribe')

		const unsubscribed = await unsubscribedMessage

		expect(unsubscribed.type).toBe('message')
		expect(unsubscribed.data).toBe('false')

		await wsClosed(ws)
		app.stop()
	})

	it('should validate success', async () => {
		const app = new Elysia()
			.ws('/ws', {
				body: t.Object({
					message: t.String()
				}),
				message(ws, { message }) {
					ws.send(message)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send(JSON.stringify({ message: 'Hello!' }))

		const { type, data } = await message

		expect(type).toBe('message')
		expect(data).toBe('Hello!')

		await wsClosed(ws)
		app.stop()
	})

	it('should validate fail', async () => {
		const app = new Elysia()
			.ws('/ws', {
				body: t.Object({
					message: t.String()
				}),
				message(ws, { message }) {
					ws.send(message)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send('Hello!')

		const { type, data } = await message

		expect(type).toBe('message')
		expect(data).toStartWith('Invalid message')

		await wsClosed(ws)
		app.stop()
	})

	it('should send from plugin', async () => {
		const plugin = new Elysia().ws('/ws', {
			message(ws, message) {
				ws.send(message)
			}
		})

		const app = new Elysia().use(plugin).listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send('Hello!')

		const { type, data } = await message

		expect(type).toBe('message')
		expect(data).toBe('Hello!')

		await wsClosed(ws)
		app.stop()
	})

	it('should be able to receive binary data', async () => {
		const plugin = new Elysia().ws('/ws', {
			message(ws, message) {
				ws.send(message)
			}
		})

		const app = new Elysia().use(plugin).listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send(new Uint8Array(3))

		const { type, data } = await message

		expect(type).toBe('message')
		expect(data).toEqual(new Uint8Array(3))

		await wsClosed(ws)
		app.stop()
	})
})
