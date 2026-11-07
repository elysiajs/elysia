import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { websocket } from '../../src/plugin/websocket'

import { newWebsocket, wsClosed, wsMessage, wsOpen } from './utils'

const upgrade = (app: Elysia<any, any, any, any, any, any, any>) =>
	fetch(`http://${app.server!.hostname}:${app.server!.port}/chat`, {
		headers: {
			upgrade: 'websocket',
			connection: 'Upgrade',
			'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
			'sec-websocket-version': '13'
		}
	})

// Context keys are copied onto the socket instance. One named like a socket
// member threw on assignment (getter), broke the connection (`raw`, even
// crashing the process from the close handler) or was silently dropped
// (`ws`), so the upgrade refuses it with the key named.
describe('WebSocket context key collision', () => {
	for (const [key, register] of [
		['id', (app: Elysia) => app.derive(() => ({ id: 'user-1' }))],
		['raw', (app: Elysia) => app.derive(() => ({ raw: { token: 'a' } }))],
		['ws', (app: Elysia) => app.derive(() => ({ ws: 42 }))],
		['data', (app: Elysia) => app.derive(() => ({ data: { u: 1 } }))],
		['close', (app: Elysia) => app.decorate('close', () => 'closing')],
		['subscribe', (app: Elysia) => app.decorate('subscribe', 1)]
	] as const)
		it(`refuses a "${key}" context key at the upgrade`, async () => {
			const app = (register(new Elysia().use(websocket())) as Elysia)
				.ws('/chat', { message() {} })
				.listen(0)

			const response = await upgrade(app)
			const body = await response.text()

			expect(response.status).toBe(500)
			expect(body).toContain(
				`WS /chat: context key \\"${key}\\" (from derive or decorate) collides with a WebSocket property`
			)

			app.stop()
		})

	// only what `for..in` copies can collide: a hidden `id` is never copied,
	// so the socket keeps its own
	for (const mode of ['own', 'inherited'] as const)
		it(`keeps a non-enumerable ${mode} "id" on the context`, async () => {
			const app = new Elysia()
				.use(websocket())
				.ws('/chat', {
					transform(context: any) {
						const hidden = { value: 'metadata', enumerable: false }
						if (mode === 'own')
							Object.defineProperty(context, 'id', hidden)
						else
							Object.setPrototypeOf(
								context,
								Object.defineProperty(
									Object.create(
										Object.getPrototypeOf(context)
									),
									'id',
									hidden
								)
							)
					},
					open(ws) {
						ws.send(`id:${ws.id !== 'metadata' && typeof ws.id}`)
					},
					message() {}
				})
				.listen(0)

			const ws = newWebsocket(app.server!, '/chat')
			await wsOpen(ws)

			expect((await wsMessage(ws)).data).toBe('id:string')

			await wsClosed(ws)
			app.stop()
		})

	it('keeps a context key that names no socket member', async () => {
		const app = new Elysia()
			.use(websocket())
			.decorate('greeting', 'hi')
			.derive(() => ({ user: 'alice' }))
			.ws('/chat', {
				message(ws) {
					ws.send(`${ws.greeting} ${ws.user} ${typeof ws.id}`)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!, '/chat')
		await wsOpen(ws)
		ws.send('go')

		expect((await wsMessage(ws)).data).toBe('hi alice string')

		await wsClosed(ws)
		app.stop()
	})
})
