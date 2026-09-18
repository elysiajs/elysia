import { describe, expect, it } from 'bun:test'

import { Elysia, problem } from '../../src'

describe('Headers-instance response metadata', () => {
	it('writes one jar cookie', async () => {
		const app = new Elysia().get('/', ({ set, cookie }) => {
			set.headers = new Headers() as any
			cookie.session.value = 'abc123'
			return 'ok'
		})

		const res = await app.handle(new Request('http://localhost/'))
		expect(res.headers.getSetCookie().length).toBe(1)
		expect(res.headers.getSetCookie()[0]).toContain('session=abc123')
	})

	it('writes multiple jar cookies exactly once', async () => {
		const app = new Elysia().get('/', ({ set, cookie }) => {
			set.headers = new Headers() as any
			cookie.session.value = 'abc123'
			cookie.theme.value = 'dark'
			return 'ok'
		})

		const res = await app.handle(new Request('http://localhost/'))
		const sc = res.headers.getSetCookie()
		expect(sc.length).toBe(2)
		expect(sc.some((c) => c.includes('session=abc123'))).toBe(true)
		expect(sc.some((c) => c.includes('theme=dark'))).toBe(true)
	})

	it('writes a directly assigned set.cookie', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers = new Headers() as any
			set.cookie = { session: { value: 'abc123' } } as any
			return 'ok'
		})

		const res = await app.handle(new Request('http://localhost/'))
		expect(res.headers.getSetCookie().length).toBe(1)
		expect(res.headers.getSetCookie()[0]).toContain('session=abc123')
	})

	it('keeps plain-object set.headers cookie behavior', async () => {
		const app = new Elysia()
			.get('/one', ({ set, cookie }) => {
				set.headers = {}
				cookie.session.value = 'abc123'
				return 'ok'
			})
			.get('/two', ({ set, cookie }) => {
				set.headers = {}
				cookie.session.value = 'abc123'
				cookie.theme.value = 'dark'
				return 'ok'
			})

		const one = await app.handle(new Request('http://localhost/one'))
		expect(one.headers.getSetCookie().length).toBe(1)

		const two = await app.handle(new Request('http://localhost/two'))
		expect(two.headers.getSetCookie().length).toBe(2)
	})

	it('preserves user headers alongside cookies', async () => {
		const app = new Elysia().get('/', ({ set, cookie }) => {
			set.headers = new Headers() as any
			;(set.headers as unknown as Headers).set(
				'authorization',
				'Bearer xyz'
			)
			cookie.session.value = 'abc123'
			return 'ok'
		})

		const res = await app.handle(new Request('http://localhost/'))
		expect(res.headers.get('authorization')).toBe('Bearer xyz')
		expect(res.headers.getSetCookie().length).toBe(1)
	})

	it('preserves a user-set content type', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers = new Headers() as any
			;(set.headers as unknown as Headers).set(
				'content-type',
				'text/custom'
			)
			return 'body'
		})

		const res = await app.handle(new Request('http://localhost/'))
		expect(res.headers.get('content-type')).toBe('text/custom')
	})

	it('appends jar cookies to existing Set-Cookie headers', async () => {
		const app = new Elysia().get('/', ({ set, cookie }) => {
			const headers = new Headers()
			headers.append('set-cookie', 'user=manual; Path=/')
			set.headers = headers as any
			cookie.session.value = 'abc123'
			return 'ok'
		})

		const res = await app.handle(new Request('http://localhost/'))
		const sc = res.headers.getSetCookie()
		expect(sc.length).toBe(2)
		expect(sc.some((c) => c.includes('user=manual'))).toBe(true)
		expect(sc.some((c) => c.includes('session=abc123'))).toBe(true)
	})

	it('preserves the problem response content type', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers = new Headers() as any
			;(set.headers as unknown as Headers).set('x-keep', 'yes')
			return problem({ status: 409, title: 'Conflict', detail: 'boom' })
		})

		const res = await app.handle(new Request('http://localhost/'))
		expect(res.status).toBe(409)
		expect(res.headers.get('content-type')).toBe('application/problem+json')
		expect(res.headers.get('x-keep')).toBe('yes')
	})

	it('merges streaming Response headers with set.headers', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers = new Headers({ 'x-set': 'from-set' }) as any
			set.status = 200
			const stream = new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('hello'))
					controller.close()
				}
			})
			return new Response(stream, {
				headers: {
					'x-source': 'from-response',
					'content-type': 'text/custom'
				}
			})
		})

		const res = await app.handle(new Request('http://localhost/'))
		expect(res.headers.get('x-source')).toBe('from-response')
		expect(res.headers.get('content-type')).toBe('text/custom')
		expect(res.headers.get('x-set')).toBe('from-set')
	})

	it('preserves hook headers and the problem content type on 404', async () => {
		const app = new Elysia()
			.request(({ set }) => {
				set.headers = new Headers({ 'x-foo': '1' }) as any
			})
			.get('/exists', () => 'ok')

		const res = await app.handle(new Request('http://localhost/missing'))
		expect(res.status).toBe(404)
		expect(res.headers.get('x-foo')).toBe('1')
		expect(res.headers.get('content-type')).toBe('application/problem+json')
	})

	it('preserves multiple appended Set-Cookie headers', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			const headers = new Headers()
			headers.append('set-cookie', 'a=1; Path=/')
			headers.append('set-cookie', 'b=2; Path=/')
			set.headers = headers as any
			set.status = 200
			return 'ok'
		})

		const res = await app.handle(new Request('http://localhost/'))
		const sc = res.headers.getSetCookie()
		expect(sc.length).toBe(2)
		expect(sc.some((c) => c.includes('a=1'))).toBe(true)
		expect(sc.some((c) => c.includes('b=2'))).toBe(true)
	})
})
