import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

// Regression tests for the kiana handler fixes (src/handler/fetch.ts + error.ts).
// Each test fails on the pre-fix code and passes after the fix.

describe('handler fixes (kiana)', () => {
	// idx1 — findRoute must not crash when the router is undefined.
	// A static-only app never creates `~router` (it is lazily built only for
	// dynamic routes). With a `.request` hook (and no trace) an unmatched path is
	// dispatched into findRoute, whose `router.find(...)` previously threw on the
	// undefined router and surfaced as a 500 instead of the correct 404.
	it('returns 404 (not 500) for an unmatched path on a static-only app with a request hook', async () => {
		const app = new Elysia()
			// returns undefined => does not short-circuit, falls through to findRoute
			.request(() => {})
			.get('/exists', () => 'hi')

		const res = await app.handle(req('/nope'))

		expect(res.status).toBe(404)
		await expect(res.text()).resolves.toBe('Not Found')
	})

	// idx4 — a returning error handler whose value is a plain domain object that
	// merely carries a `status` field must NOT have that field reused as the HTTP
	// status. Only ElysiaStatus / Response may dictate the status; otherwise the
	// error stays 500.
	it('does not let a returned plain object .status field clobber the error HTTP status', async () => {
		const app = new Elysia()
			.error(() => ({ status: 'pending', message: 'retry' }))
			.get('/', () => {
				throw new Error('boom')
			})

		const res = await app.handle(req('/'))

		// pre-fix: set.status='pending' -> StatusMap['pending']===undefined -> 200
		expect(res.status).toBe(500)
		await expect(res.json()).resolves.toEqual({
			status: 'pending',
			message: 'retry'
		})
	})

	// idx4 (companion) — an error handler that DOES return status() must still
	// drive the HTTP status (guards against the fix over-reaching).
	it('still honors status() returned from an error handler', async () => {
		const app = new Elysia()
			.error(({ status }) => status(418, 'teapot'))
			.get('/', () => {
				throw new Error('boom')
			})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(418)
		await expect(res.text()).resolves.toBe('teapot')
	})

	// idx11 (sync) — a short-circuiting request hook must still invoke
	// afterResponse, matching the trace branch.
	it('runs afterResponse when a sync request hook short-circuits', async () => {
		let ran = false

		const app = new Elysia()
			.request(({ set }) => {
				set.status = 418
				return 'sc'
			})
			.afterResponse(() => {
				ran = true
			})
			.get('/x', () => 'real')

		const res = await app.handle(req('/x'))
		expect(res.status).toBe(418)

		await Bun.sleep(1)
		expect(ran).toBe(true)
	})

	// idx11 (async) — same, when an async request hook is present (forces the
	// async non-trace branch).
	it('runs afterResponse when an async request hook short-circuits', async () => {
		let ran = false

		const app = new Elysia()
			.request(async ({ set }) => {
				set.status = 418
				return 'sc'
			})
			.afterResponse(() => {
				ran = true
			})
			.get('/x', () => 'real')

		const res = await app.handle(req('/x'))
		expect(res.status).toBe(418)

		await Bun.sleep(1)
		expect(ran).toBe(true)
	})

	// idx12 — the default 404 must still emit `Elysia.headers` defaults instead of
	// dropping them via the bare cached Not Found response.
	it('applies configured default headers to the default 404 response', async () => {
		const app = new Elysia()
			.headers({ 'x-powered-by': 'elysia' })
			.get('/exists', () => 'hi')

		const hit = await app.handle(req('/exists'))
		expect(hit.headers.get('x-powered-by')).toBe('elysia')

		const miss = await app.handle(req('/missing'))
		expect(miss.status).toBe(404)
		// pre-fix: getNotFound() dropped set.headers => null
		expect(miss.headers.get('x-powered-by')).toBe('elysia')
	})

	// idx12 — headers written by a request hook must also survive the 404.
	it('applies request-hook headers to the 404 response', async () => {
		const app = new Elysia()
			.request(({ set }) => {
				set.headers['x-from-hook'] = 'yes'
			})
			.get('/exists', () => 'hi')

		const miss = await app.handle(req('/missing'))
		expect(miss.status).toBe(404)
		expect(miss.headers.get('x-from-hook')).toBe('yes')
	})

	// idx32 — when an error hook handles NotFound and sets a different status,
	// afterResponse must observe that status, not a hard-coded 404.
	it('afterResponse observes the error-hook status on a handled NotFound, not 404', async () => {
		let observed: number | undefined

		const app = new Elysia()
			.error(({ set }) => {
				set.status = 418
				return 'teapot'
			})
			.afterResponse(({ set }) => {
				observed = set.status as number
			})
			.get('/x', () => 'real')

		const res = await app.handle(req('/missing'))
		// client-facing response is correct in both old and new code
		expect(res.status).toBe(418)
		await expect(res.text()).resolves.toBe('teapot')

		await Bun.sleep(1)
		// pre-fix: afterResponse(context, 404) forced set.status back to 404
		expect(observed).toBe(418)
	})
})
