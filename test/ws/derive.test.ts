import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

// Run each route twice to verify derived state remains available on later upgrades.
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
		await expectDerived(app.server!, 'alice')

		app.stop()
	})

	it('mapDerive survives a second upgrade to the same route', async () => {
		const app = new Elysia()
			.mapDerive(() => ({ user: 'bob' }))
			.ws('/ws', {
				message(ws: any) {
					ws.send(ws.user)
				}
			})
			.listen(0)

		await expectDerived(app.server!, 'bob')
		await expectDerived(app.server!, 'bob')

		app.stop()
	})
})
