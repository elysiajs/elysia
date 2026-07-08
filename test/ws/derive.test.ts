import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

// One connect→ping→assert→close roundtrip. Each test runs it twice: the
// derive-mode queue was consumed destructively (.shift()) per request, so the
// SECOND upgrade mis-classified the derive result as a plain beforeHandle
// response and returned HTTP 200 instead of opening the socket.
const expectDerived = async (server: any, value: string) => {
	const ws = newWebsocket(server)
	await wsOpen(ws)
	const msg = wsMessage(ws)
	ws.send('ping')
	const { data } = await msg
	expect(data).toBe(value)
	await wsClosed(ws)
}

describe('WebSocket derive', () => {
	it('derive survives a second upgrade to the same route', async () => {
		const app = new Elysia()
			.derive(() => ({ user: 'alice' }))
			.ws('/ws', {
				message(ws: any) {
					ws.send(ws.user)
				}
			})
			.listen(0)

		await expectDerived(app.server!, 'alice')
		// Second connection — the regression target
		await expectDerived(app.server!, 'alice')

		app.stop()
	})

	it('mapDerive survives a second upgrade to the same route', async () => {
		// Same regression but exercising the mapDerive code path (mode=true,
		// i.e. replaceDeriveContext rather than Object.assign).
		const app = new Elysia()
			.mapDerive(() => ({ user: 'bob' }))
			.ws('/ws', {
				message(ws: any) {
					ws.send(ws.user)
				}
			})
			.listen(0)

		await expectDerived(app.server!, 'bob')
		// Second connection — the regression target
		await expectDerived(app.server!, 'bob')

		app.stop()
	})
})
