import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { newWebsocket, wsOpen, wsClosed, wsMessage } from './utils'

describe('WebSocket method binding', () => {
	it('a detached method (const { send } = ws) keeps its receiver', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws) {
					// Detached methods must retain the WebSocket receiver.
					const {
						send,
						subscribe,
						isSubscribed,
						unsubscribe,
						publish
					} = ws as any

					subscribe('topic')
					const subscribed = isSubscribed('topic')
					publish('topic', 'noop')
					unsubscribe('topic')

					send(`detached:${subscribed}`)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('go')

		expect((await message).data).toBe('detached:true')

		await wsClosed(ws)
		app.stop()
	})

	it('the same bound send is reused across messages on one connection', async () => {
		const identities: unknown[] = []

		const app = new Elysia()
			.ws('/ws', {
				message(ws) {
					identities.push((ws as any).send)
					;(ws as any).send('ok')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const m1 = wsMessage(ws)
		ws.send('a')
		await m1
		const m2 = wsMessage(ws)
		ws.send('b')
		await m2

		expect(identities.length).toBe(2)
		expect(identities[0]).toBe(identities[1])

		await wsClosed(ws)
		app.stop()
	})

	it('an error handler can send when open throws', async () => {
		// Throw before any bound method is materialized.
		const app = new Elysia()
			.ws('/ws', {
				open() {
					throw new Error('boom')
				},
				error({ send }: any) {
					send('recovered')
					return undefined
				},
				message() {}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		const message = wsMessage(ws)
		await wsOpen(ws)

		expect((await message).data).toBe('recovered')

		await wsClosed(ws)
		app.stop()
	})
})

describe('WebSocket upgrade context retention', () => {
	it('releases retained context after the connection view is materialized', async () => {
		let contextAfterOpen: unknown = Symbol('unset')

		const app = new Elysia()
			.ws('/ws', {
				open(ws) {
					contextAfterOpen = ws.raw.data.retained
				},
				message(ws) {
					ws.send('ok')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('go')
		expect((await message).data).toBe('ok')

		expect(contextAfterOpen).toBeUndefined()

		await wsClosed(ws)
		app.stop()
	})
})
