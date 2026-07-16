import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t, status, ValidationError } from '../../src'
import { newWebsocket, wsOpen, wsClosed, wsMessage } from './utils'

describe('WebSocket errors thrown by error hooks', () => {
	it('sends an error frame without an unhandled rejection', async () => {
		const unhandledRejections: unknown[] = []
		const onUnhandled = (reason: unknown) => {
			unhandledRejections.push(reason)
		}
		process.on('unhandledRejection', onUnhandled)

		const app = new Elysia()
			.error((_ctx: any) => {
				throw new Error('secondary hook failure')
			})
			.ws('/ws', {
				message() {
					throw new Error('original error')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const msg = wsMessage(ws)
		ws.send('trigger')

		const { data } = await msg

		// Let any leaked rejection reach the process listener.
		await Bun.sleep(30)

		process.off('unhandledRejection', onUnhandled)

		expect(unhandledRejections).toHaveLength(0)
		expect(typeof data).toBe('string')
		expect(String(data).length).toBeGreaterThan(0)

		await wsClosed(ws)
		app.stop()
	})
})

describe('WebSocket rejected message handlers', () => {
	it('does not emit an unhandledRejection', async () => {
		const unhandledRejections: unknown[] = []
		const onUnhandled = (reason: unknown) => {
			unhandledRejections.push(reason)
		}
		process.on('unhandledRejection', onUnhandled)

		const app = new Elysia()
			.ws('/ws', {
				async message() {
					await Promise.reject(new Error('dispatch rejected'))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		ws.send('trigger')

		// Let any leaked rejection reach the process listener.
		await Bun.sleep(50)

		process.off('unhandledRejection', onUnhandled)

		expect(unhandledRejections).toHaveLength(0)

		await wsClosed(ws)
		app.stop()
	})

	it('sends an error frame after the handler rejects', async () => {
		const app = new Elysia()
			.ws('/ws', {
				async message() {
					throw new Error('boom async')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const msg = wsMessage(ws)
		ws.send('trigger')

		const { data } = await msg

		expect(typeof data).toBe('string')
		expect(String(data).length).toBeGreaterThan(0)

		await wsClosed(ws)
		app.stop()
	})
})

describe('WebSocket production validation errors without error hooks', () => {
	afterEach(() => {
		delete process.env.NODE_ENV
	})

	it('masks validation details by default in production', async () => {
		process.env.NODE_ENV = 'production'

		const app = new Elysia()
			.ws('/ws', {
				body: t.Object({ x: t.Number() }),
				message() {}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const msg = wsMessage(ws)
		ws.send(JSON.stringify({ x: 'not-a-number' }))

		const { data } = await msg
		const parsed = JSON.parse(String(data))

		expect(parsed).toMatchObject({
			type: 'validation',
			title: 'Validation Error',
			status: 422,
			on: 'body'
		})
		expect(parsed.detail).toBeUndefined()
		expect(parsed.found).toBeUndefined()
		expect(parsed.errors).toBeUndefined()

		await wsClosed(ws)
		app.stop()
	})

	it('includes validation details when explicitly enabled in production', async () => {
		process.env.NODE_ENV = 'production'

		const app = new Elysia({ allowUnsafeValidationDetails: true })
			.ws('/ws', {
				body: t.Object({ x: t.Number() }),
				message() {}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const msg = wsMessage(ws)
		ws.send(JSON.stringify({ x: 'not-a-number' }))

		const { data } = await msg
		const parsed = JSON.parse(String(data))

		expect(parsed).toMatchObject({
			type: 'validation',
			title: 'Validation Error',
			status: 422,
			on: 'body'
		})
		expect(typeof parsed.detail).toBe('string')
		expect(parsed.detail.length).toBeGreaterThan(0)
		expect(parsed.found).toBeDefined()
		expect(parsed.errors.length).toBeGreaterThan(0)

		await wsClosed(ws)
		app.stop()
	})
})

describe('WebSocket upgrade validation error responses', () => {
	it('uses the status and text body returned by the error hook', async () => {
		const app = new Elysia()
			.error(({ error }: any) => {
				if (error instanceof ValidationError)
					return status(401, 'denied')
			})
			.ws('/ws', {
				query: t.Object({ name: t.String() }),
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

		expect(upgradeResponse.status).toBe(401)
		await expect(upgradeResponse.text()).resolves.toBe('denied')

		app.stop()
	})

	it('uses the status and JSON body returned by the error hook', async () => {
		const app = new Elysia()
			.error(({ error }: any) => {
				if (error instanceof ValidationError)
					return status(403, { msg: 'forbidden' })
			})
			.ws('/ws', {
				query: t.Object({ name: t.String() }),
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
		await expect(upgradeResponse.json()).resolves.toEqual({
			msg: 'forbidden'
		})

		app.stop()
	})
})
