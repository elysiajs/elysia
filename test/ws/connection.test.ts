import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
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
		expect(code).toBe(1001) // going away -> https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1

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
})
