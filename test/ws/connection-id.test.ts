import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

describe('WebSocket connection id', () => {
	it('assigns distinct non-empty ids to concurrent connections', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				message(ws) {
					ws.send(ws.id)
				}
			})
			.listen(0)

		const a = newWebsocket(app.server!)
		const b = newWebsocket(app.server!)
		await wsOpen(a)
		await wsOpen(b)

		const aMessage = wsMessage(a)
		const bMessage = wsMessage(b)
		a.send('id?')
		b.send('id?')

		const aId = (await aMessage).data as string
		const bId = (await bMessage).data as string

		expect(aId).toBeTruthy()
		expect(bId).toBeTruthy()
		expect(aId).not.toBe('')
		expect(bId).not.toBe('')
		expect(aId).not.toBe(bId)

		await wsClosed(a)
		await wsClosed(b)
		app.stop()
	})

	it('reuses one id for every message on a connection', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				message(ws) {
					ws.send(ws.id)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const first = wsMessage(ws)
		ws.send('1')
		const firstId = (await first).data as string

		const second = wsMessage(ws)
		ws.send('2')
		const secondId = (await second).data as string

		expect(firstId).toBeTruthy()
		expect(firstId).toBe(secondId)

		await wsClosed(ws)
		app.stop()
	})
})
