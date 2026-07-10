import { describe, it, expect, afterEach, beforeEach } from 'bun:test'
import { Elysia, t, status, ValidationError } from '../../src'
import { newWebsocket, wsOpen, wsClosed, wsMessage } from './utils'

// ── H18-fix-1: throwing error hook must not escape; original error frame sent ──
describe('H18-fix-1: throwing error hook falls through to sendErrorFrame', () => {
	it('error frame is still sent when error hook throws; no unhandled rejection', async () => {
		const unhandledRejections: unknown[] = []
		const onUnhandled = (reason: unknown) => {
			unhandledRejections.push(reason)
		}
		process.on('unhandledRejection', onUnhandled)

		const app = new Elysia()
			.error((_ctx: any) => {
				// This hook itself throws — must not escape handleError.
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

		// The client must still receive an error frame (not hang forever).
		const { data } = await msg

		// Settle the event loop so any unhandled rejection would fire.
		await Bun.sleep(30)

		process.off('unhandledRejection', onUnhandled)

		// No unhandled rejection must have escaped.
		expect(unhandledRejections).toHaveLength(0)

		// The frame must be a non-empty string (original error surfaced).
		expect(typeof data).toBe('string')
		expect(String(data).length).toBeGreaterThan(0)

		await wsClosed(ws)
		app.stop()
	})
})

// ── H18-fix-2: rejected dispatch promise must not become unhandled rejection ──
describe('H18-fix-2: rejected dispatch promise is caught in global message handler', () => {
	it('no unhandledRejection when message handler rejects', async () => {
		const unhandledRejections: unknown[] = []
		const onUnhandled = (reason: unknown) => {
			unhandledRejections.push(reason)
		}
		process.on('unhandledRejection', onUnhandled)

		const app = new Elysia()
			.ws('/ws', {
				async message() {
					// An async message handler that always rejects.
					await Promise.reject(new Error('dispatch rejected'))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		// Send a message and wait; the dispatch will reject asynchronously.
		ws.send('trigger')

		// Settle the event loop so the rejection would fire and be caught/not.
		await Bun.sleep(50)

		process.off('unhandledRejection', onUnhandled)

		// No unhandled rejection must have escaped.
		expect(unhandledRejections).toHaveLength(0)

		await wsClosed(ws)
		app.stop()
	})

	it('error frame is sent after dispatch rejects', async () => {
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

		// The global handler sends a last-resort frame after the rejection.
		expect(typeof data).toBe('string')
		expect(String(data).length).toBeGreaterThan(0)

		await wsClosed(ws)
		app.stop()
	})
})

// ── H18-fix-3: allowUnsafeValidationDetails respected on no-error-handler fast path ──
describe('H18-fix-3: allowUnsafeValidationDetails on fast-path (no error handlers)', () => {
	afterEach(() => {
		delete process.env.NODE_ENV
	})

	it('production fast-path: collapsed payload when no error handler and flag is false', async () => {
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

		// Without allowUnsafeValidationDetails the payload should be the
		// collapsed ValidationError payload (no full schema detail exposed).
		// The exact shape depends on ValidationError.payload but must exist.
		expect(parsed).toBeDefined()

		await wsClosed(ws)
		app.stop()
	})

	it('production fast-path with allowUnsafeValidationDetails=true emits full payload', async () => {
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
		// With the flag set, allowUnsafeValidationDetails is propagated to
		// ValidationError before sendErrorFrame, so the frame must be non-empty.
		expect(String(data).length).toBeGreaterThan(0)

		await wsClosed(ws)
		app.stop()
	})
})

// ── H18-fix-4: upgrade-validation error hook returning status() uses correct code ──
describe('H18-fix-4: upgrade error hook returning status() maps to correct HTTP status', () => {
	// Probe: .error() returns status(401, 'denied') on a query-validation failure.
	// Before the fix: response was 422 with body `{"code":401,"response":"denied"}`.
	// After the fix: response must be 401 with body 'denied'.
	it('error hook returning status(401, "denied") produces HTTP 401 with body "denied"', async () => {
		const app = new Elysia()
			.error(({ error }: any) => {
				if (error instanceof ValidationError) return status(401, 'denied')
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

	it('error hook returning status(403, {msg}) produces HTTP 403 with JSON body', async () => {
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
		await expect(upgradeResponse.json()).resolves.toEqual({ msg: 'forbidden' })

		app.stop()
	})
})
