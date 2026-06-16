import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { newWebsocket, wsOpen, wsClosed, wsMessage } from './utils'

// F7 — ElysiaWS exposes its raw-socket + self methods via memoizing getters
// (bound lazily on first access, cached onto the connection) instead of 14
// eager binds per connection. These tests pin the behaviour the getters MUST
// preserve: detached methods survive destructuring, the bound closure is shared
// across messages, and error handlers can still reach the methods via the
// prototype chain.
describe('WebSocket lazy-bound methods (F7)', () => {
	it('a detached method (const { send } = ws) keeps its receiver', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws) {
					// Detach EVERY method touched by the suite from the instance —
					// if the getter returned an unbound function these would lose
					// `this` and throw on the raw-socket access inside.
					const { send, subscribe, isSubscribed, unsubscribe, publish } =
						ws as any

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
		// The getter memoizes onto the CONNECTION (raw.data.elysia), not onto the
		// per-message Object.create view — so two messages must observe the exact
		// same function identity. A per-message memoization would defeat F7.
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

	it('an error handler can still call ctx.send when open() throws', async () => {
		// errCtx is Object.create(elysia), so the lazily-bound prototype getters
		// remain reachable even though no method was materialised before the
		// throw. A plain-object copy (Object.assign({}, elysia)) would leave
		// errCtx.send undefined here.
		const app = new Elysia()
			.ws('/ws', {
				open() {
					throw new Error('boom')
				},
				error({ send }: any) {
					// `send` reached purely through the prototype chain of the
					// freshly-created errCtx — never accessed before the throw.
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

// F13 — the upgrade Context is sprayed onto the ElysiaWS instance by the lazy
// constructor; its sole consumer is getElysia, so ws.data.context is released to
// undefined afterwards to avoid double-retaining the upgrade Request/set for the
// whole connection lifetime.
describe('WebSocket connection retention (F13)', () => {
	it('ws.data.context is released after the connection materialises', async () => {
		let contextAfterOpen: unknown = Symbol('unset')

		const app = new Elysia()
			.ws('/ws', {
				open(ws) {
					// By the time any event fires, getElysia has run and nulled
					// the duplicate Context shell.
					contextAfterOpen = (ws as any).raw.data.context
				},
				message(ws) {
					ws.send('ok')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		// A message must still round-trip after the release (the spray already
		// copied everything the handler needs onto the instance).
		const message = wsMessage(ws)
		ws.send('go')
		expect((await message).data).toBe('ok')

		expect(contextAfterOpen).toBeUndefined()

		await wsClosed(ws)
		app.stop()
	})
})
