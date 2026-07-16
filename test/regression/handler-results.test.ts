import { describe, expect, it } from 'bun:test'

import { Elysia, sse, status, t } from '../../src'
import { req } from '../utils'

describe('handler result processing', () => {
	it('awaits a handler Promise before response validation', async () => {
		const app = new Elysia().get(
			'/',
			{ response: t.Object({ name: t.String() }) },
			() => Promise.resolve({ name: 'a' })
		)

		const response = await app.handle(req('/'))
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ name: 'a' })
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

		const response = await app.handle(req('/'))
		expect(response.status).toBe(200)
		expect(await response.text()).toBe('hi')
	})

	it('routes a rejected handler Promise through a synchronous error hook', async () => {
		const app = new Elysia()
			.error(() => new Response('handled', { status: 500 }))
			.get('/', { beforeHandle: () => {} }, () =>
				Promise.reject(new Error('boom'))
			)

		const response = await app.handle(req('/'))
		expect(response.status).toBe(500)
		expect(await response.text()).toBe('handled')
	})
})

describe('response status and headers', () => {
	it('preserves multiple Set-Cookie headers when status() wraps the body', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			;(set.headers as any)['set-cookie'] = ['a=1', 'b=2']
			return status(201, { ok: true })
		})

		const response = await app.handle(req('/'))
		expect(response.status).toBe(201)
		expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2'])
		expect(await response.json()).toEqual({ ok: true })
	})

	it('produces the same empty 204 response for named and numeric statuses', async () => {
		const named = new Elysia().get('/named', () => status('No Content'))
		const numeric = new Elysia().get('/numeric', () => status(204))

		const namedResponse = await named.handle(req('/named'))
		const numericResponse = await numeric.handle(req('/numeric'))

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

		const response = await app.handle(req('/stream'))
		expect(response.headers.get('content-type')).toBe('text/event-stream')
		expect(response.headers.get('cache-control')).toBe('no-cache')
		expect(response.headers.getAll('set-cookie')).toHaveLength(2)
		expect(await response.text()).toBe('data: one\n\ndata: two\n\n')
	})
})
