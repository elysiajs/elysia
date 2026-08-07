import { describe, it, expect, afterEach } from 'bun:test'
import {
	Elysia,
	HTTPError,
	problem,
	t,
	status,
	ValidationError
} from '../../src'
import { websocket } from '../../src/plugin/websocket'
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
			.use(websocket()).ws('/ws', {
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
			.use(websocket()).ws('/ws', {
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
			.use(websocket()).ws('/ws', {
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
			.use(websocket()).ws('/ws', {
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
			.use(websocket()).ws('/ws', {
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
			.use(websocket()).ws('/ws', {
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
			.use(websocket()).ws('/ws', {
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

describe('WebSocket self-describing errors', () => {
	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {
		detail() {
			return 'Out of credit'
		}
	}

	// A frame is the only thing a socket can serve, so an error that
	// self-describes has to describe itself here too — the pre-parity frame
	// was the empty message of an error that never carried one
	it('serves a problem frame for a thrown HTTPError', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				message() {
					throw new OutOfCredit()
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const msg = wsMessage(ws)
		ws.send('trigger')

		const { data } = await msg

		expect(JSON.parse(String(data))).toEqual({
			type: 'OUT_OF_CREDIT',
			title: 'Payment Required',
			detail: 'Out of credit',
			status: 402
		})

		await wsClosed(ws)
		app.stop()
	})

	// `value` is the escape hatch on both transports: no envelope, the
	// annotation is the whole frame
	it('serves an annotated value as the whole frame', async () => {
		class Legacy extends HTTPError.id('LEGACY', 402) {
			value() {
				return { code: 'LEGACY', ok: false }
			}
		}

		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				message() {
					throw new Legacy()
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const msg = wsMessage(ws)
		ws.send('trigger')

		const { data } = await msg

		expect(JSON.parse(String(data))).toEqual({
			code: 'LEGACY',
			ok: false
		})

		await wsClosed(ws)
		app.stop()
	})

	// The hook produced an untyped problem while intercepting a typed error;
	// ElysiaWS wraps an ElysiaStatus as `{ status, error }` on the wire
	it('adopts the error type into a problem returned by an error hook', async () => {
		const app = new Elysia()
			.error(() => problem(402, { detail: 'from hook' }))
			.use(websocket()).ws('/ws', {
				message() {
					throw new OutOfCredit()
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const msg = wsMessage(ws)
		ws.send('trigger')

		const { data } = await msg
		const parsed = JSON.parse(String(data))

		expect(parsed.status).toBe(402)
		expect(parsed.error.type).toBe('OUT_OF_CREDIT')
		expect(parsed.error.detail).toBe('from hook')

		await wsClosed(ws)
		app.stop()
	})

	// The point of the parity work: one error class, one document, whichever
	// transport it is thrown on
	it('serves the same problem document on HTTP and WebSocket', async () => {
		const app = new Elysia()
			.get('/http', () => {
				throw new OutOfCredit()
			})
			.use(websocket()).ws('/ws', {
				message() {
					throw new OutOfCredit()
				}
			})
			.listen(0)

		const response = await app.handle('/http')
		const body = await response.text()

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const msg = wsMessage(ws)
		ws.send('trigger')

		const { data } = await msg

		expect(String(data)).toBe(body)

		await wsClosed(ws)
		app.stop()
	})
})
