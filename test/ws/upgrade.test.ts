import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { newWebsocket, wsOpen, wsClosed, wsMessage } from './utils'

// hook.upgrade (static object / function form) previously had zero coverage.
describe('WebSocket upgrade option', () => {
	it('accepts a static upgrade headers object', async () => {
		const app = new Elysia()
			.ws('/ws', {
				upgrade: { 'x-powered-by': 'elysia' },
				open(ws) {
					ws.send('upgraded')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		const message = wsMessage(ws)
		await wsOpen(ws)

		expect((await message).data).toBe('upgraded')

		await wsClosed(ws)
		app.stop()
	})

	it('calls an upgrade function with the upgrade context', async () => {
		let called = false

		const app = new Elysia()
			.ws('/ws', {
				upgrade(context) {
					called = context.path === '/ws'

					return { 'x-powered-by': 'elysia' }
				},
				open(ws) {
					ws.send('upgraded')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		const message = wsMessage(ws)
		await wsOpen(ws)

		expect((await message).data).toBe('upgraded')
		expect(called).toBe(true)

		await wsClosed(ws)
		app.stop()
	})
})
