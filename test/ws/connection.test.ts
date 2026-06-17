import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { newWebsocket, wsOpen, wsClose, wsClosed, wsMessage } from './utils'
import { req } from '../utils'

describe('WebSocket connection', () => {
	it('should connect and close', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message() {}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)
		await wsClosed(ws)
		app.stop()
	})

	it('should close by server', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws) {
					ws.close()
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		ws.send('close me!')

		const { wasClean, code } = await wsClose(ws)
		expect(wasClean).toBe(false)
		expect(code).toBe(1000) // going away -> https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1

		app.stop()
	})

	it('should terminate by server', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws) {
					ws.terminate()
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		ws.send('close me!')

		const { wasClean, code } = await wsClose(ws)
		expect(wasClean).toBe(false)
		expect(code).toBe(1006) // closed abnormally -> https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1

		app.stop()
	})

	it('should separate get from ws', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message() {}
			})
			.get('/ws', () => 'hi')
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)
		await wsClosed(ws)

		const response = await app.handle(req('/ws')).then((x) => x.text())
		expect(response).toBe('hi')

		app.stop()
	})

	it('should separate all from ws', async () => {
		const app = new Elysia()
			.all('/ws', () => 'hi')
			.ws('/ws', {
				message() {}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)
		await wsClosed(ws)

		const response = await app.handle(req('/ws')).then((x) => x.text())
		expect(response).toBe('hi')

		app.stop()
	})

	it('should separate dynamic get from ws', async () => {
		const app = new Elysia()
			.ws('/ws/:id', {
				message() {}
			})
			.get('/ws/:id', () => 'hi')
			.listen(0)

		const ws = newWebsocket(app.server!, '/ws/1')

		await wsOpen(ws)
		await wsClosed(ws)

		const response = await app.handle(req('/ws/1')).then((x) => x.text())
		expect(response).toBe('hi')

		app.stop()
	})

	it('should separate dynamic all from ws', async () => {
		const app = new Elysia()
			.all('/ws/:id', () => 'hi')
			.ws('/ws/:id', {
				message() {}
			})
			.listen(0)

		const ws = newWebsocket(app.server!, '/ws/1')

		await wsOpen(ws)
		await wsClosed(ws)

		const response = await app.handle(req('/ws/1')).then((x) => x.text())
		expect(response).toBe('hi')

		app.stop()
	})

	it('handle derive, resolve', async () => {
		let sessionId: string | undefined
		let user: { id: '123'; name: 'Jane Doe' } | undefined

		const app = new Elysia()
			.derive(() => ({
				sessionId: '123'
			}))
			.derive(() => ({
				getUser() {
					return {
						id: '123',
						name: 'Jane Doe'
					} as const
				}
			}))
			.ws('/ws', {
				open(ws) {
					sessionId = (ws as any).sessionId
					user = (ws as any).getUser()
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!, '/ws')

		await wsOpen(ws)
		await wsClosed(ws)

		expect(sessionId).toEqual('123')
		expect(user).toEqual({
			id: '123',
			name: 'Jane Doe'
		})
	})

	it('derive runs once per connection, not per message', async () => {
		let deriveCalls = 0

		const app = new Elysia()
			.derive(() => {
				deriveCalls++
				return { token: `t${deriveCalls}` }
			})
			.ws('/ws', {
				message(ws: any) {
					ws.send(ws.token)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		// Three messages on the same connection.
		const tokens: string[] = []
		ws.onmessage = (e) => tokens.push(String(e.data))

		ws.send('a')
		ws.send('b')
		ws.send('c')

		await Bun.sleep(50)

		// All three should return the SAME token — derive fired once on
		// upgrade and the value persists for the lifetime of the connection.
		expect(deriveCalls).toBe(1)
		expect(tokens).toEqual(['t1', 't1', 't1'])

		await wsClosed(ws)
		app.stop()
	})

	it('transform fires at BOTH upgrade and per-message', async () => {
		let calls = 0

		const app = new Elysia()
			.ws('/ws', {
				transform() {
					calls++
				},
				message(ws: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)
		// At this point transform should have fired ONCE (upgrade).
		expect(calls).toBe(1)

		const got1 = wsMessage(ws)
		ws.send('a')
		await got1
		expect(calls).toBe(2)

		const got2 = wsMessage(ws)
		ws.send('b')
		await got2
		expect(calls).toBe(3)

		await wsClosed(ws)
		app.stop()
	})

	it('beforeHandle short-circuits the upgrade with HTTP response', async () => {
		const app = new Elysia()
			.ws('/ws', {
				beforeHandle() {
					return new Response('forbidden', { status: 403 })
				},
				message() {}
			})
			.listen(0)

		const upgradeResponse = await fetch(
			`http://${app.server!.hostname}:${app.server!.port}/ws`,
			{
				headers: {
					upgrade: 'websocket',
					connection: 'Upgrade',
					'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
					'sec-websocket-version': '13'
				}
			}
		)

		expect(upgradeResponse.status).toBe(403)
		await expect(upgradeResponse.text()).resolves.toBe('forbidden')

		app.stop()
	})

	it('call ping/pong', async () => {
		let pinged = false
		let ponged = false

		const app = new Elysia()
			.ws('/', {
				ping() {
					pinged = true
				},
				pong() {
					ponged = true
				},
				async message(ws) {}
			})
			.listen(0)

		const ws = new WebSocket(`ws://localhost:${app.server?.port}`)

		await new Promise<void>((resolve) => {
			ws.addEventListener(
				'open',
				() => {
					ws.ping()
					ws.send('df')
					ws.pong()

					resolve()
				},
				{
					once: true
				}
			)
		})

		await Bun.sleep(3)

		expect(pinged).toBe(true)
		expect(ponged).toBe(true)
	})
})
