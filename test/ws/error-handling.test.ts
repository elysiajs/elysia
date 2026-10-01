import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
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

// `detail` and `name` on an error frame are development-only, so NODE_ENV
// steers what a frame discloses. A test may pin it, but must hand back the
// value it found: deleting it would drop the runner's own `test`
let originalNodeEnv: string | undefined
beforeEach(() => {
	originalNodeEnv = process.env.NODE_ENV
})
afterEach(() => {
	if (originalNodeEnv === undefined) delete process.env.NODE_ENV
	else process.env.NODE_ENV = originalNodeEnv
})

// Rejects instead of hanging, so a step that never happens fails the test
// *and* still reaches its `finally` cleanup
const within = async (promise: Promise<unknown>, ms: number, what: string) => {
	let timer: ReturnType<typeof setTimeout> | undefined

	try {
		await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`${what} did not happen in ${ms}ms`)),
					ms
				)
			})
		])
	} finally {
		clearTimeout(timer)
	}
}

describe('WebSocket errors thrown by error hooks', () => {
	it('sends an error frame without an unhandled rejection', async () => {
		process.env.NODE_ENV = 'development'

		const unhandledRejections: unknown[] = []
		const onUnhandled = (reason: unknown) => {
			unhandledRejections.push(reason)
		}

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

		process.on('unhandledRejection', onUnhandled)
		let ws: WebSocket | undefined

		try {
			ws = newWebsocket(app.server!)
			await wsOpen(ws)

			const msg = wsMessage(ws)
			ws.send('trigger')

			const { data } = await msg

			// Let any leaked rejection reach the process listener.
			await Bun.sleep(30)

			expect(unhandledRejections).toHaveLength(0)

			// The frame describes the error the handler threw, not the
			// failure of the hook that tried to handle it
			expect(JSON.parse(String(data))).toEqual({
				type: 'internal-server-error',
				code: 'internal-server-error',
				title: 'Internal Server Error',
				status: 500,
				detail: 'original error',
				name: 'Error'
			})
		} finally {
			process.off('unhandledRejection', onUnhandled)
			if (ws && ws.readyState !== WebSocket.CLOSED) await wsClosed(ws)
			app.stop()
		}
	})
})

describe('WebSocket rejected message handlers', () => {
	it('does not emit an unhandledRejection', async () => {
		const unhandledRejections: unknown[] = []
		const onUnhandled = (reason: unknown) => {
			unhandledRejections.push(reason)
		}
		const handlerRan = Promise.withResolvers<void>()

		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				async message() {
					handlerRan.resolve()
					await Promise.reject(new Error('dispatch rejected'))
				}
			})
			.listen(0)

		process.on('unhandledRejection', onUnhandled)
		let ws: WebSocket | undefined

		try {
			ws = newWebsocket(app.server!)
			await wsOpen(ws)

			ws.send('trigger')

			// Without this the check below passes even if `message()` never
			// ran, since nothing rejected means nothing leaked
			await within(handlerRan.promise, 2000, 'message() running')

			// Bounded wait for the negative observation only: let any leaked
			// rejection reach the process listener.
			await Bun.sleep(50)

			expect(unhandledRejections).toHaveLength(0)
		} finally {
			process.off('unhandledRejection', onUnhandled)
			if (ws && ws.readyState !== WebSocket.CLOSED) await wsClosed(ws)
			app.stop()
		}
	})

	it('sends an error frame after the handler rejects', async () => {
		process.env.NODE_ENV = 'development'

		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				async message() {
					throw new Error('boom async')
				}
			})
			.listen(0)

		let ws: WebSocket | undefined

		try {
			ws = newWebsocket(app.server!)
			await wsOpen(ws)

			const msg = wsMessage(ws)
			ws.send('trigger')

			const { data } = await msg

			expect(JSON.parse(String(data))).toEqual({
				type: 'internal-server-error',
				code: 'internal-server-error',
				title: 'Internal Server Error',
				status: 500,
				detail: 'boom async',
				name: 'Error'
			})
		} finally {
			if (ws && ws.readyState !== WebSocket.CLOSED) await wsClosed(ws)
			app.stop()
		}
	})
})

describe('WebSocket production validation errors without error hooks', () => {
	it('masks validation details by default in production', async () => {
		process.env.NODE_ENV = 'production'

		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				body: t.Object({ x: t.Number() }),
				message() {}
			})
			.listen(0)

		let ws: WebSocket | undefined

		try {
			ws = newWebsocket(app.server!)
			await wsOpen(ws)

			const msg = wsMessage(ws)
			ws.send(JSON.stringify({ x: 'not-a-number' }))

			const { data } = await msg
			const parsed = JSON.parse(String(data))

			expect(parsed).toMatchObject({
				type: 'validation',
				code: 'validation',
				title: 'Validation Error',
				status: 422,
				on: 'body'
			})
			expect(parsed.detail).toBeUndefined()
			expect(parsed.found).toBeUndefined()
			expect(parsed.errors).toBeUndefined()
		} finally {
			if (ws && ws.readyState !== WebSocket.CLOSED) await wsClosed(ws)
			app.stop()
		}
	})

	it('includes validation details when explicitly enabled in production', async () => {
		process.env.NODE_ENV = 'production'

		const app = new Elysia({ allowUnsafeValidationDetails: true })
			.use(websocket()).ws('/ws', {
				body: t.Object({ x: t.Number() }),
				message() {}
			})
			.listen(0)

		let ws: WebSocket | undefined

		try {
			ws = newWebsocket(app.server!)
			await wsOpen(ws)

			const msg = wsMessage(ws)
			ws.send(JSON.stringify({ x: 'not-a-number' }))

			const { data } = await msg
			const parsed = JSON.parse(String(data))

			expect(parsed).toMatchObject({
				type: 'validation',
				code: 'validation',
				title: 'Validation Error',
				status: 422,
				on: 'body'
			})
			expect(typeof parsed.detail).toBe('string')
			expect(parsed.detail.length).toBeGreaterThan(0)
			expect(parsed.found).toBeDefined()
			expect(parsed.errors.length).toBeGreaterThan(0)
		} finally {
			if (ws && ws.readyState !== WebSocket.CLOSED) await wsClosed(ws)
			app.stop()
		}
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

		try {
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
		} finally {
			app.stop()
		}
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

		try {
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
		} finally {
			app.stop()
		}
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

		let ws: WebSocket | undefined

		try {
			ws = newWebsocket(app.server!)
			await wsOpen(ws)

			const msg = wsMessage(ws)
			ws.send('trigger')

			const { data } = await msg

			expect(JSON.parse(String(data))).toEqual({
				type: 'OUT_OF_CREDIT',
				code: 'OUT_OF_CREDIT',
				title: 'Payment Required',
				detail: 'Out of credit',
				status: 402
			})
		} finally {
			if (ws && ws.readyState !== WebSocket.CLOSED) await wsClosed(ws)
			app.stop()
		}
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

		let ws: WebSocket | undefined

		try {
			ws = newWebsocket(app.server!)
			await wsOpen(ws)

			const msg = wsMessage(ws)
			ws.send('trigger')

			const { data } = await msg

			expect(JSON.parse(String(data))).toEqual({
				code: 'LEGACY',
				ok: false
			})
		} finally {
			if (ws && ws.readyState !== WebSocket.CLOSED) await wsClosed(ws)
			app.stop()
		}
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

		let ws: WebSocket | undefined

		try {
			ws = newWebsocket(app.server!)
			await wsOpen(ws)

			const msg = wsMessage(ws)
			ws.send('trigger')

			const { data } = await msg
			const parsed = JSON.parse(String(data))

			expect(parsed.status).toBe(402)
			expect(parsed.error.type).toBe('OUT_OF_CREDIT')
			expect(parsed.error.detail).toBe('from hook')
		} finally {
			if (ws && ws.readyState !== WebSocket.CLOSED) await wsClosed(ws)
			app.stop()
		}
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

		let ws: WebSocket | undefined

		try {
			const response = await app.handle('/http')
			const body = await response.text()

			ws = newWebsocket(app.server!)
			await wsOpen(ws)

			const msg = wsMessage(ws)
			ws.send('trigger')

			const { data } = await msg

			expect(String(data)).toBe(body)
		} finally {
			if (ws && ws.readyState !== WebSocket.CLOSED) await wsClosed(ws)
			app.stop()
		}
	})
})
