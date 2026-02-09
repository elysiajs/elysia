import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

describe('WebSocket object identity (#1716)', () => {
	it('should return the same ElysiaWS instance across open and message hooks', async () => {
		let openWs: any
		let messageWs: any

		const app = new Elysia()
			.ws('/ws', {
				open(ws) {
					openWs = ws
				},
				message(ws, message) {
					messageWs = ws
					ws.send('ok')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const reply = wsMessage(ws)
		ws.send('hello')

		await reply

		expect(openWs).toBeDefined()
		expect(messageWs).toBeDefined()
		expect(openWs).toBe(messageWs)

		await wsClosed(ws)
		app.stop()
	})

	it('should return the same ElysiaWS instance across open and close hooks', async () => {
		let openWs: any
		let closeWs: any

		const app = new Elysia()
			.ws('/ws', {
				open(ws) {
					openWs = ws
				},
				message() {},
				close(ws) {
					closeWs = ws
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		// Give the open hook time to fire
		await Bun.sleep(10)

		await wsClosed(ws)

		// Give the close hook time to fire
		await Bun.sleep(10)

		expect(openWs).toBeDefined()
		expect(closeWs).toBeDefined()
		expect(openWs).toBe(closeWs)

		app.stop()
	})

	it('should return the same instance across open, message, and close', async () => {
		const instances: any[] = []

		const app = new Elysia()
			.ws('/ws', {
				open(ws) {
					instances.push(ws)
				},
				message(ws) {
					instances.push(ws)
					ws.send('ack')
				},
				close(ws) {
					instances.push(ws)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const reply = wsMessage(ws)
		ws.send('test')
		await reply

		await wsClosed(ws)
		await Bun.sleep(10)

		expect(instances.length).toBe(3)
		expect(instances[0]).toBe(instances[1])
		expect(instances[1]).toBe(instances[2])

		app.stop()
	})

	it('should preserve custom properties set in open hook', async () => {
		let customPropInMessage: string | undefined
		let customPropInClose: string | undefined

		const app = new Elysia()
			.ws('/ws', {
				open(ws) {
					;(ws as any)._customId = 'test-id-123'
				},
				message(ws) {
					customPropInMessage = (ws as any)._customId
					ws.send('ok')
				},
				close(ws) {
					customPropInClose = (ws as any)._customId
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const reply = wsMessage(ws)
		ws.send('hi')
		await reply

		await wsClosed(ws)
		await Bun.sleep(10)

		expect(customPropInMessage).toBe('test-id-123')
		expect(customPropInClose).toBe('test-id-123')

		app.stop()
	})

	it('should maintain separate identity for different connections', async () => {
		const instances = new Set<any>()

		const app = new Elysia()
			.ws('/ws', {
				open(ws) {
					instances.add(ws)
				},
				message() {}
			})
			.listen(0)

		const ws1 = newWebsocket(app.server!)
		await wsOpen(ws1)

		const ws2 = newWebsocket(app.server!)
		await wsOpen(ws2)

		// Give open hooks time to fire
		await Bun.sleep(10)

		expect(instances.size).toBe(2)

		await wsClosed(ws1)
		await wsClosed(ws2)

		app.stop()
	})

	it('should allow tracking connections in a Set and cleaning up on close', async () => {
		const activeConnections = new Set<any>()

		const app = new Elysia()
			.ws('/ws', {
				open(ws) {
					activeConnections.add(ws)
				},
				message() {},
				close(ws) {
					activeConnections.delete(ws)
				}
			})
			.listen(0)

		const ws1 = newWebsocket(app.server!)
		await wsOpen(ws1)

		const ws2 = newWebsocket(app.server!)
		await wsOpen(ws2)

		await Bun.sleep(10)

		expect(activeConnections.size).toBe(2)

		await wsClosed(ws1)
		await Bun.sleep(10)

		// ws1 should be removed because close handler received the same instance
		expect(activeConnections.size).toBe(1)

		await wsClosed(ws2)
		await Bun.sleep(10)

		expect(activeConnections.size).toBe(0)

		app.stop()
	})

	it('should allow per-socket state storage in a Map', async () => {
		const socketState = new Map<any, { messageCount: number }>()

		const app = new Elysia()
			.ws('/ws', {
				open(ws) {
					socketState.set(ws, { messageCount: 0 })
				},
				message(ws) {
					const state = socketState.get(ws)
					if (state) {
						state.messageCount++
					}
					ws.send(`count:${state?.messageCount}`)
				},
				close(ws) {
					socketState.delete(ws)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		// Send 3 messages and check state accumulates
		let reply = wsMessage(ws)
		ws.send('a')
		let msg = await reply
		expect(msg.data).toBe('count:1')

		reply = wsMessage(ws)
		ws.send('b')
		msg = await reply
		expect(msg.data).toBe('count:2')

		reply = wsMessage(ws)
		ws.send('c')
		msg = await reply
		expect(msg.data).toBe('count:3')

		await wsClosed(ws)
		await Bun.sleep(10)

		expect(socketState.size).toBe(0)

		app.stop()
	})

	it('should update body on each message while preserving identity', async () => {
		const bodies: unknown[] = []
		let stableWs: any

		const app = new Elysia()
			.ws('/ws', {
				open(ws) {
					stableWs = ws
				},
				message(ws, message) {
					bodies.push(ws.body)
					expect(ws).toBe(stableWs)
					ws.send('ok')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		let reply = wsMessage(ws)
		ws.send('first')
		await reply

		reply = wsMessage(ws)
		ws.send('second')
		await reply

		expect(bodies[0]).toBe('first')
		expect(bodies[1]).toBe('second')

		await wsClosed(ws)
		app.stop()
	})
})
