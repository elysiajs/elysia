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
					() =>
						reject(new Error(`${what} did not happen in ${ms}ms`)),
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
			.onError((_ctx: any) => {
				throw new Error('secondary hook failure')
			})
			.use(websocket())
			.ws('/ws', {
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
			.use(websocket())
			.ws('/ws', {
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
			.use(websocket())
			.ws('/ws', {
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
			.use(websocket())
			.ws('/ws', {
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
			.use(websocket())
			.ws('/ws', {
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
			.onError(({ error }: any) => {
				if (error instanceof ValidationError)
					return status(401, 'denied')
			})
			.use(websocket())
			.ws('/ws', {
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
			.onError(({ error }: any) => {
				if (error instanceof ValidationError)
					return status(403, { msg: 'forbidden' })
			})
			.use(websocket())
			.ws('/ws', {
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
		override readonly detail = 'Out of credit'
	}

	// A frame is the only thing a socket can serve, so an error that
	// self-describes has to describe itself here too — the pre-parity frame
	// was the empty message of an error that never carried one
	it('serves a problem frame for a thrown HTTPError', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
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

	// As on HTTP, an error an error hook returns is served as an unhandled
	// one, never dispatched again
	it('serves an error returned by an error hook as a thrown one', async () => {
		let dispatched = false
		const app = new Elysia()
			.use(websocket())
			.onError(OutOfCredit, () => {
				dispatched = true
				return status(418, 'teapot')
			})
			.ws('/ws', {
				error: () => new OutOfCredit(),
				beforeHandle({ query }) {
					if (query.upgrade) throw new Error('caught')
				},
				message() {
					throw new Error('caught')
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

			const upgrade = await app.handle(
				new Request('http://localhost/ws?upgrade=1', {
					headers: { upgrade: 'websocket' }
				})
			)
			expect(upgrade.status).toBe(402)
			expect(dispatched).toBe(false)
		} finally {
			if (ws && ws.readyState !== WebSocket.CLOSED) await wsClosed(ws)
			app.stop()
		}
	})

	// As on HTTP, an error given no message has no `detail`, while an
	// explicit `''` was given and is served as-is
	it('serves `detail` only for a given message', async () => {
		class Bare extends HTTPError.id('BARE', 402) {}

		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message(_, message) {
					throw message === 'none' ? new Bare() : new Bare('')
				}
			})
			.listen(0)

		const envelope = {
			type: 'BARE',
			code: 'BARE',
			title: 'Payment Required',
			status: 402
		}

		try {
			for (const [send, frame] of [
				['none', envelope],
				['empty', { ...envelope, detail: '' }]
			] as const) {
				const ws = newWebsocket(app.server!)

				try {
					await wsOpen(ws)

					const msg = wsMessage(ws)
					ws.send(send)

					const { data } = await msg

					expect(JSON.parse(String(data))).toEqual(frame)
				} finally {
					if (ws.readyState !== WebSocket.CLOSED) await wsClosed(ws)
				}
			}
		} finally {
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
			.use(websocket())
			.ws('/ws', {
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

	// As on HTTP, a `detail` method is never invoked, sync or async: the
	// frame serves the message, as for an error that annotated nothing
	it('never invokes a `detail` method', async () => {
		let invoked = 0

		class Removed extends HTTPError.id('REMOVED', 402) {
			// @ts-expect-error `detail` is a string, not a method
			detail() {
				invoked++
				throw new Error('detail must not run')
			}
		}

		class RemovedAsync extends HTTPError.id('REMOVED', 402) {
			// @ts-expect-error `detail` is a string, not a method
			async detail() {
				invoked++
				return 'must not be served'
			}
		}

		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message(_, message) {
					throw message === 'sync'
						? new Removed('the message')
						: new RemovedAsync('the message')
				}
			})
			.listen(0)

		try {
			for (const send of ['sync', 'async']) {
				const ws = newWebsocket(app.server!)

				try {
					await wsOpen(ws)

					const msg = wsMessage(ws)
					ws.send(send)

					const { data } = await msg

					expect(JSON.parse(String(data))).toEqual({
						type: 'REMOVED',
						code: 'REMOVED',
						title: 'Payment Required',
						detail: 'the message',
						status: 402
					})
				} finally {
					if (ws.readyState !== WebSocket.CLOSED) await wsClosed(ws)
				}
			}
		} finally {
			app.stop()
		}

		expect(invoked).toBe(0)
	})

	// As on HTTP, a promised `detail` is plain data, never awaited, a
	// rejected one included: the frame is the document HTTP serves
	it('never awaits a promised detail', async () => {
		class Pending extends Error {
			type = 'PENDING' as const
			readonly status = 409

			constructor(readonly detail: Promise<unknown>) {
				super('the message')
			}
		}

		const rejected = Promise.reject(new Error('rejected-marker'))
		rejected.catch(() => {})

		const thrown = (which: string) =>
			new Pending(
				which === 'rejected'
					? rejected
					: Promise.resolve({ marker: 'resolved-marker' })
			)

		const app = new Elysia()
			.get('/http/:which', ({ params }) => {
				throw thrown(params.which)
			})
			.use(websocket())
			.ws('/ws', {
				message(_, message) {
					throw thrown(String(message))
				}
			})
			.listen(0)

		try {
			for (const which of ['resolved', 'rejected']) {
				const http = await (await app.handle(`/http/${which}`)).text()
				const ws = newWebsocket(app.server!)

				try {
					await wsOpen(ws)

					const msg = wsMessage(ws)
					ws.send(which)

					const frame = String((await msg).data)

					expect(frame).not.toContain('marker')
					expect(JSON.parse(frame)).toEqual({
						type: 'PENDING',
						title: 'Conflict',
						detail: {},
						status: 409
					})
					expect(frame).toBe(http)
				} finally {
					if (ws.readyState !== WebSocket.CLOSED) await wsClosed(ws)
				}
			}
		} finally {
			app.stop()
		}
	})

	// The hook produced an untyped problem while intercepting a typed error;
	// ElysiaWS wraps an ElysiaStatus as `{ status, error }` on the wire
	it('adopts the error type into a problem returned by an error hook', async () => {
		const app = new Elysia()
			.onError(() => problem(402, { detail: 'from hook' }))
			.use(websocket())
			.ws('/ws', {
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
			.use(websocket())
			.ws('/ws', {
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

	// Extension members are part of that one document: the frame carries
	// them, keeps the members Elysia owns, and masks a foreign 5xx in
	// production exactly as HTTP does
	for (const production of [false, true])
		it(`serves extension members as HTTP does (${production ? 'production' : 'development'})`, async () => {
			if (production) process.env.NODE_ENV = 'production'

			const ran: string[] = []

			class Credit extends HTTPError.id('OUT_OF_CREDIT', 402) {
				readonly detail =
					'Your current balance is 30, but that costs 50'

				extension() {
					ran.push('owned')
					return {
						balance: 30,
						accounts: ['/account/12345'],
						type: 'https://evil.example/hijack',
						detail: 'spoofed'
					}
				}
			}

			class Foreign extends Error {
				type = 'UNAVAILABLE'
				status = 503

				extension() {
					ran.push('foreign')
					return { internalHost: 'db-7.internal' }
				}
			}

			const thrown = (which: string) =>
				which === 'owned' ? new Credit() : new Foreign('secret')

			const app = new Elysia()
				.get('/http/:which', ({ params }) => {
					throw thrown(params.which)
				})
				.use(websocket())
				.ws('/ws', {
					message(_, message) {
						throw thrown(String(message))
					}
				})
				.listen(0)

			try {
				for (const which of ['owned', 'foreign']) {
					const http = await (
						await app.handle(`/http/${which}`)
					).text()
					const ws = newWebsocket(app.server!)

					try {
						await wsOpen(ws)

						const msg = wsMessage(ws)
						ws.send(which)

						expect(String((await msg).data)).toBe(http)
					} finally {
						if (ws.readyState !== WebSocket.CLOSED)
							await wsClosed(ws)
					}

					expect(JSON.parse(http)).toEqual(
						which === 'owned'
							? {
									type: 'OUT_OF_CREDIT',
									code: 'OUT_OF_CREDIT',
									title: 'Payment Required',
									detail: 'Your current balance is 30, but that costs 50',
									status: 402,
									balance: 30,
									accounts: ['/account/12345']
								}
							: {
									type: 'UNAVAILABLE',
									title: 'Service Unavailable',
									detail: production
										? 'Service Unavailable'
										: 'secret',
									status: 503,
									...(production
										? {}
										: { internalHost: 'db-7.internal' })
								}
					)
				}
			} finally {
				app.stop()
			}

			expect(ran).toEqual(
				production
					? ['owned', 'owned']
					: ['owned', 'owned', 'foreign', 'foreign']
			)
		})

	// An extension is data. A function member is behavior that would take
	// over how the document is served: `toJSON` re-labels it, a callable
	// `next` turns it into a stream, `then` into a thenable, a symbol
	// iterator into an iterable. None of them is served, on either transport
	it('serves no function member of an extension', async () => {
		const spoof = {
			type: 'https://evil.example/hijack',
			code: 'HIJACK',
			status: 200,
			detail: 'spoofed'
		}

		const members: Record<string, () => object> = {
			toJSON: () => ({ toJSON: () => spoof }),
			next: () => ({
				next: () => ({ done: false, value: 'stream-replaced' })
			}),
			then: () => ({
				then: (resolve: (value: unknown) => void) =>
					resolve('thenable-replaced')
			}),
			asyncIterator: () => ({
				async *[Symbol.asyncIterator]() {
					yield 'iterated'
				}
			})
		}

		const thrown = (which: string) =>
			new (class Hijack extends HTTPError.id('CONFLICT', 409) {
				extension() {
					return { ...members[which](), balance: 30 }
				}
			})()

		const app = new Elysia()
			.get('/http/:which', ({ params }) => {
				throw thrown(params.which)
			})
			.use(websocket())
			.ws('/ws', {
				message(_, message) {
					throw thrown(String(message))
				}
			})
			.listen(0)

		try {
			for (const which of Object.keys(members)) {
				const response = await app.handle(`/http/${which}`)
				const http = await response.text()

				expect({ which, status: response.status }).toEqual({
					which,
					status: 409
				})
				expect({ which, body: JSON.parse(http) }).toEqual({
					which,
					body: {
						type: 'CONFLICT',
						code: 'CONFLICT',
						title: 'Conflict',
						status: 409,
						balance: 30
					}
				})

				const ws = newWebsocket(app.server!)

				try {
					await wsOpen(ws)

					const msg = wsMessage(ws)
					ws.send(which)

					expect(String((await msg).data)).toBe(http)
				} finally {
					if (ws.readyState !== WebSocket.CLOSED) await wsClosed(ws)
				}
			}
		} finally {
			app.stop()
		}
	})

	// The error's own `detail` wins, else a string one from its extension,
	// else the message: on both transports, production masking included
	for (const production of [false, true])
		it(`serves an extension \`detail\` as HTTP does (${production ? 'production' : 'development'})`, async () => {
			if (production) process.env.NODE_ENV = 'production'

			class Explained extends HTTPError.id('UNAVAILABLE', 503) {
				extension(): Record<string, unknown> {
					return {
						detail:
							this.message === 'number'
								? 42
								: 'Retry in 30 seconds'
					}
				}
			}

			class Own extends Explained {
				override readonly detail = 'own'
			}

			class Foreign extends Error {
				type = 'UNAVAILABLE'
				status = 503

				extension() {
					return { detail: 'db-7.internal is down' }
				}
			}

			const thrown = (which: string) =>
				which === 'own'
					? new Own()
					: which === 'foreign'
						? new Foreign('secret')
						: new Explained(which)

			const expected: Record<string, string> = {
				own: 'own',
				extension: 'Retry in 30 seconds',
				number: production ? 'Service Unavailable' : 'number',
				foreign: production
					? 'Service Unavailable'
					: 'db-7.internal is down'
			}

			const app = new Elysia()
				.get('/http/:which', ({ params }) => {
					throw thrown(params.which)
				})
				.use(websocket())
				.ws('/ws', {
					message(_, message) {
						throw thrown(String(message))
					}
				})
				.listen(0)

			try {
				for (const [which, detail] of Object.entries(expected)) {
					const http = await (
						await app.handle(`/http/${which}`)
					).text()

					expect({ which, detail: JSON.parse(http).detail }).toEqual({
						which,
						detail
					})

					const ws = newWebsocket(app.server!)

					try {
						await wsOpen(ws)

						const msg = wsMessage(ws)
						ws.send(which)

						expect(String((await msg).data)).toBe(http)
					} finally {
						if (ws.readyState !== WebSocket.CLOSED)
							await wsClosed(ws)
					}
				}
			} finally {
				app.stop()
			}
		})
})

// A hook reaches only the routes registered after it, as in Elysia 1, on a
// WebSocket route as on HTTP
describe('WebSocket error hook registered after the route', () => {
	class Late extends Error {}

	const upgrade = (app: { server: any }, path = '/ws') =>
		fetch(`http://${app.server!.hostname}:${app.server!.port}${path}`, {
			headers: {
				upgrade: 'websocket',
				connection: 'Upgrade',
				'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
				'sec-websocket-version': '13'
			}
		})

	const onValidation = ({ error }: any) => {
		if (error instanceof ValidationError) return status(401, 'hook')
	}

	const routes = (app: any, error?: () => void) =>
		app
			.use(websocket())
			.ws('/ws', {
				query: t.Object({ name: t.String() }),
				...(error ? { error } : {}),
				message() {}
			})
			.get('/http', { query: t.Object({ name: t.String() }) }, () => 'ok')

	it('answers an upgrade error with an earlier error hook only, as on HTTP', async () => {
		for (const [hook, code] of [
			['later', 422],
			['earlier', 401]
		] as const)
			for (const error of [undefined, () => {}]) {
				const app = (
					hook === 'later'
						? routes(new Elysia(), error).onError(onValidation)
						: routes(new Elysia().onError(onValidation), error)
				).listen(0)

				try {
					expect([
						hook,
						(await upgrade(app)).status,
						(await app.handle(new Request('http://localhost/http')))
							.status
					]).toEqual([hook, code, code])
				} finally {
					app.stop()
				}
			}
	})

	it('keeps a later error hook off a message error', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message() {
					throw new Late()
				}
			})
			.onError(Late, () => status(418, 'late'))
			.listen(0)

		let ws: WebSocket | undefined

		try {
			ws = newWebsocket(app.server!)
			await wsOpen(ws)

			const msg = wsMessage(ws)
			ws.send('trigger')

			const { data } = await msg

			expect(JSON.parse(String(data)).status).toBe(500)
		} finally {
			if (ws && ws.readyState !== WebSocket.CLOSED) await wsClosed(ws)
			app.stop()
		}
	})

	// What an upgrade's error hook throws ends with the route's own hooks,
	// as on HTTP: an earlier handler for the new error still answers
	it('answers what an error hook throws with the earlier hooks, as on HTTP', async () => {
		for (const precompile of [false, true]) {
			const app = new Elysia({ precompile })
				.use(websocket())
				.onError(({ error }: any) => {
					if (error instanceof RangeError)
						throw new TypeError('secondary')
				})
				.onError(TypeError, () => status(418, 'caught secondary'))
				.onBeforeHandle(() => {
					throw new RangeError('original')
				})
				.get('/http', () => 'ok')
				.ws('/ws', { message: () => 'ok' })

			const served = async (path: string, headers?: HeadersInit) => {
				const response = await app.handle(
					new Request(`http://localhost${path}`, { headers })
				)

				return `${response.status} ${await response.text()}`
			}

			expect({
				http: await served('/http'),
				ws: await served('/ws', { upgrade: 'websocket' })
			}).toEqual({
				http: '418 caught secondary',
				ws: '418 caught secondary'
			})
		}
	})
})

// an error hook's status reaches mapResponse through `set.status`, as on
// HTTP; the connection's `set` is shared by every message, so it must land
// on the error frame alone, never on the next or a concurrent message
describe('WebSocket message error status in mapResponse', () => {
	it('shows the status and error to mapResponse for that frame only', async () => {
		const seen: [string, unknown, boolean][] = []
		const mapResponse = (ws: any) => {
			seen.push([String(ws.body), ws.set.status, 'error' in ws])
		}
		const app = new Elysia()
			.use(websocket())
			.get('/h', { error: () => status(418, 'tea'), mapResponse }, () => {
				throw new Error('x')
			})
			.ws('/ws', {
				error: () => status(418, 'tea'),
				mapResponse,
				async message(_ws, body: any) {
					if (body === 'boom') throw new Error('x')
					if (body === 'slow') await Bun.sleep(30)

					return `ok:${body}`
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		try {
			ws.send('boom')
			expect((await wsMessage(ws)).data).toBe(
				'{"status":418,"error":"tea"}'
			)

			ws.send('fine')
			expect((await wsMessage(ws)).data).toBe('ok:fine')

			// `boom` answers while `slow` is still in flight
			ws.send('slow')
			ws.send('boom')
			expect((await wsMessage(ws)).data).toBe(
				'{"status":418,"error":"tea"}'
			)
			expect((await wsMessage(ws)).data).toBe('ok:slow')

			const http = await app.handle(new Request('http://localhost/h'))
			expect(http.status).toBe(418)

			expect(seen).toEqual([
				['boom', 418, true],
				['fine', undefined, false],
				['boom', 418, true],
				['slow', undefined, false],
				['undefined', 418, true]
			])
		} finally {
			await wsClosed(ws)
			app.stop()
		}
	})

	// only the status is the error frame's own: `set.headers` and the cookie
	// jar are connection state for every message hook, so a header the error
	// hook or mapResponse writes is seen by the next frame, exactly as one a
	// normal message handler writes. The status never leaks, neither to the
	// next message nor to one answered while the hook is still parked
	it("keeps an error hook's status on that frame, headers on the connection", async () => {
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const errorFrames: [unknown, unknown][] = []
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				async error({ set, error }: any) {
					set.status = 418
					set.headers['x-hook'] = '1'
					if (error.message === 'slow') await gate

					return 'handled'
				},
				mapResponse(context: any) {
					if (!('error' in context)) return

					context.set.headers['x-map'] = '1'
					errorFrames.push([
						context.set.status,
						context.set.headers['x-hook']
					])
				},
				message(ws: any, body: unknown) {
					if (body === 'boom' || body === 'slow')
						throw new Error(body as string)
					if (body === 'tag') ws.set.headers['x-msg'] = '1'

					return JSON.stringify({
						status: ws.set.status,
						msg: ws.set.headers['x-msg'],
						hook: ws.set.headers['x-hook'],
						map: ws.set.headers['x-map']
					})
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		try {
			// control: a normal handler's header write persists to later frames
			ws.send('tag')
			expect((await wsMessage(ws)).data).toBe('{"msg":"1"}')
			ws.send('fine')
			expect((await wsMessage(ws)).data).toBe('{"msg":"1"}')

			ws.send('boom')
			expect((await wsMessage(ws)).data).toBe('handled')

			// the error frame's headers persist the same way, its status does not
			ws.send('fine')
			expect((await wsMessage(ws)).data).toBe(
				'{"msg":"1","hook":"1","map":"1"}'
			)

			// `fine` answers while the `slow` hook holds its status
			ws.send('slow')
			ws.send('fine')
			expect((await wsMessage(ws)).data).toBe(
				'{"msg":"1","hook":"1","map":"1"}'
			)
			release()
			expect((await wsMessage(ws)).data).toBe('handled')

			expect(errorFrames).toEqual([
				[418, '1'],
				[418, '1']
			])
		} finally {
			await wsClosed(ws)
			app.stop()
		}
	})

	// HTTP accepts a `Headers` instance as `set.headers`; the error frame
	// shares the connection's container, so its entries reach the hooks
	it('shows a Headers instance on the connection to the error frame', async () => {
		const seen: unknown[] = []
		const read = (headers: any) =>
			headers instanceof Headers
				? headers.get('x-base')
				: headers?.['x-base']
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				open(ws: any) {
					ws.set.headers = new Headers({ 'x-base': 'base' })
				},
				error({ set }: any) {
					seen.push(read(set.headers))

					return 'handled'
				},
				mapResponse(context: any) {
					if ('error' in context) seen.push(read(context.set.headers))
				},
				message() {
					throw new Error('boom')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		try {
			ws.send('x')
			expect((await wsMessage(ws)).data).toBe('handled')
			expect(seen).toEqual(['base', 'base'])
		} finally {
			await wsClosed(ws)
			app.stop()
		}
	})

	// headers and the cookie jar forward to the connection's own `set`, not a
	// snapshot of its containers: replacing `set.headers` in an error hook
	// persists to the next frame, exactly as a message handler's replacement
	it("persists an error hook's set.headers replacement to the next frame", async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				error({ set }: any) {
					set.headers = new Headers({ 'x-error': 'error' })

					return 'handled'
				},
				message(ws: any, body: unknown) {
					if (body === 'boom') throw new Error('boom')

					return String(
						ws.set.headers instanceof Headers
							? ws.set.headers.get('x-error')
							: ws.set.headers['x-error']
					)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		try {
			ws.send('boom')
			expect((await wsMessage(ws)).data).toBe('handled')

			ws.send('fine')
			expect((await wsMessage(ws)).data).toBe('error')
		} finally {
			await wsClosed(ws)
			app.stop()
		}
	})

	// a cookie first written in an error hook creates the connection's
	// `set.cookie` through the Cookie object; the error frame's mapResponse
	// must see it on `set.cookie`, and so must the next frame
	it('shows a cookie the error hook creates to mapResponse and the next frame', async () => {
		const seen: unknown[] = []
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				error({ cookie }: any) {
					cookie.sid.value = 'error'

					return 'handled'
				},
				mapResponse(context: any) {
					if ('error' in context)
						seen.push(context.set.cookie?.sid?.value ?? null)
				},
				message(ws: any, body: unknown) {
					if (body === 'boom') throw new Error('boom')

					return String(ws.set.cookie?.sid?.value ?? null)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		try {
			ws.send('boom')
			expect((await wsMessage(ws)).data).toBe('handled')
			expect(seen).toEqual(['error'])

			ws.send('fine')
			expect((await wsMessage(ws)).data).toBe('error')
		} finally {
			await wsClosed(ws)
			app.stop()
		}
	})
})
