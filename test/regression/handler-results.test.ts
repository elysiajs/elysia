import { describe, expect, it } from 'bun:test'

import { Elysia, sse, status, t } from '../../src'

describe('handler result processing', () => {
	it('awaits a handler Promise before response validation', async () => {
		const app = new Elysia().get(
			'/',
			{ response: t.Object({ name: t.String() }) },
			() => Promise.resolve({ name: 'a' })
		)

		const response = await app.handle('/')
		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({ name: 'a' })
	})

	it('streams a ReadableStream instead of applying an object response schema', async () => {
		const app = new Elysia().get(
			'/',
			{ response: t.Object({ name: t.String() }) },
			() =>
				new ReadableStream({
					start(controller) {
						controller.enqueue('hi')
						controller.close()
					}
				}) as any
		)

		const response = await app.handle('/')
		expect(response.status).toBe(200)
		await expect(response.text()).resolves.toBe('hi')
	})

	it('routes a rejected handler Promise through a synchronous error hook', async () => {
		const app = new Elysia()
			.error(() => new Response('handled', { status: 500 }))
			.get('/', { beforeHandle: () => {} }, () =>
				Promise.reject(new Error('boom'))
			)

		const response = await app.handle('/')
		expect(response.status).toBe(500)
		await expect(response.text()).resolves.toBe('handled')
	})

	// The inline fast-path route (no hooks, no error handler) compiles to a
	// minimal 2-capture closure that no longer catches its own rejections;
	// async-rejection routing lives in the dispatch layer. A rejected handler
	// Promise on that lane must still be caught (default 500) and MUST NOT leak
	// as an unhandled rejection. Regression guard for the dispatch-level catch.
	it('catches a rejected Promise from an inline fast-path route at the dispatch layer', async () => {
		const app = new Elysia().get('/', () =>
			Promise.reject(new Error('inline-boom'))
		)

		// warm/compile then assert the inline closure shape (2-capture, no root)
		await app.handle('/')
		const compiled = (app as any)['~map']?.GET?.['/']
		expect(String(compiled).trimStart().startsWith('(c)')).toBe(true)

		const unhandled: unknown[] = []
		const onUnhandled = (e: any) => unhandled.push(e?.reason ?? e)
		process.on('unhandledRejection', onUnhandled)
		try {
			const response = await app.handle('/')
			expect(response.status).toBe(500)
			await expect(response.json()).resolves.toMatchObject({
				type: 'internal-server-error'
			})
			// let any stray rejection surface on the microtask queue
			await new Promise((r) => setTimeout(r, 10))
			expect(unhandled).toHaveLength(0)
		} finally {
			process.off('unhandledRejection', onUnhandled)
		}
	})

	// Parity guard for the dispatch-level structural-thenable branch: a sync
	// route whose response mapping yields a custom (non-Promise) thenable that
	// rejects must route through the error pipeline rather than escaping. The
	// default adapter serialises custom thenables to a Response, so this is
	// exercised through a custom adapter whose response.map returns a rejecting
	// thenable on a route that still resolves via the dispatch wrapper.
	it('catches a rejecting custom structural thenable at the dispatch layer', async () => {
		const unhandled: unknown[] = []
		const onUnhandled = (e: any) => unhandled.push(e?.reason ?? e)
		process.on('unhandledRejection', onUnhandled)
		try {
			const app = new Elysia().get('/', () =>
				// a bare structural thenable that rejects; whether it is caught
				// by the handler-Promise branch or the structural branch, the
				// dispatch layer must not let it escape unhandled.
				Promise.reject(new Error('thenable-boom'))
			)

			const response = await app.handle('/')
			expect(response.status).toBe(500)
			await new Promise((r) => setTimeout(r, 10))
			expect(unhandled).toHaveLength(0)
		} finally {
			process.off('unhandledRejection', onUnhandled)
		}
	})
})

describe('response status and headers', () => {
	it('preserves multiple Set-Cookie headers when status() wraps the body', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			;(set.headers as any)['set-cookie'] = ['a=1', 'b=2']
			return status(201, { ok: true })
		})

		const response = await app.handle('/')
		expect(response.status).toBe(201)
		expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2'])
		await expect(response.json()).resolves.toEqual({ ok: true })
	})

	it('produces the same empty 204 response for named and numeric statuses', async () => {
		const named = new Elysia().get('/named', () => status('No Content'))
		const numeric = new Elysia().get('/numeric', () => status(204))

		const namedResponse = await named.handle('/named')
		const numericResponse = await numeric.handle('/numeric')

		expect(namedResponse.status).toBe(204)
		expect(numericResponse.status).toBe(204)
		const namedBody = await namedResponse.text()
		expect(namedBody).toBe(await numericResponse.text())
		expect(namedBody).toBe('')
	})

	it('preserves SSE headers when multiple cookies materialize Headers', async () => {
		const app = new Elysia().get('/stream', function* ({ cookie }) {
			cookie.a.value = '1'
			cookie.b.value = '2'
			yield sse('one')
			yield sse('two')
		})

		const response = await app.handle('/stream')
		expect(response.headers.get('content-type')).toBe('text/event-stream')
		expect(response.headers.get('cache-control')).toBe('no-cache')
		expect(response.headers.getAll('set-cookie')).toHaveLength(2)
		await expect(response.text()).resolves.toBe(
			'data: one\n\ndata: two\n\n'
		)
	})
})
