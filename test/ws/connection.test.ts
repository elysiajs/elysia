import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { newWebsocket, wsOpen, wsClose, wsClosed } from './utils'
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
			.resolve(() => ({
				getUser() {
					return {
						id: '123',
						name: 'Jane Doe'
					} as const
				}
			}))
			.ws('/ws', {
				open(ws) {
					sessionId = ws.data.sessionId
					user = ws.data.getUser()
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

	it('should maintain ws object identity across open/message/close', async () => {
		let openWs: unknown
		let messageWs: unknown
		let closeWs: unknown

		const app = new Elysia()
			.ws('/ws', {
				open(ws) {
					openWs = ws
				},
				message(ws) {
					messageWs = ws
					ws.close()
				},
				close(ws) {
					closeWs = ws
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)
		ws.send('hello')
		await wsClose(ws)

		expect(openWs).toBeDefined()
		expect(messageWs).toBeDefined()
		expect(closeWs).toBeDefined()
		expect(openWs).toBe(messageWs)
		expect(openWs).toBe(closeWs)

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
				async message(ws) {
				}
			})
			.listen(0)

		const ws = new WebSocket(`ws://localhost:${app.server?.port}`)

		await new Promise<void>((resolve) => {
			ws.addEventListener('open', () => {
				ws.ping()
				ws.send('df')
				ws.pong()

				resolve()
			}, {
				once: true
			})
		})

		await Bun.sleep(3)

		expect(pinged).toBe(true)
		expect(ponged).toBe(true)
	})
})
