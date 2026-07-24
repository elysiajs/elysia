import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { Numeric } from '../../src/type/elysia/numeric'
import { Value } from 'typebox/value'

describe('t.Numeric regex is linear, not catastrophic', () => {
	it('rejects a 200 KB digit-prefix attack within 5 ms', () => {
		const schema = Numeric()
		const attack = '9'.repeat(200_000) + 'x'

		const start = performance.now()
		expect(Value.Check(schema, attack)).toBe(false)
		const elapsed = performance.now() - start

		expect(elapsed).toBeLessThan(5)
	})

	it('accepts decimal syntax and rejects unsupported numeric syntax', () => {
		const schema = Numeric()
		for (const ok of ['0', '123', '-1', '1.5', '.5', '12.', '+.5'])
			expect(Value.Check(schema, ok)).toBe(true)
		for (const bad of ['', 'abc', '1e3', '0x10', '1.2.3', '--1'])
			expect(Value.Check(schema, bad)).toBe(false)
	})
})

describe('a CRLF-poisoned header never escapes app.handle', () => {
	const crlf = 'foo\r\nx-injected: pwned'

	it('drops a reflected CRLF header without creating an injected header', async () => {
		const app = new Elysia().get('/reflect', ({ query, set }) => {
			set.headers['x-echo'] = query.v ?? ''
			return 'ok'
		})

		const res = await app.handle(
			new Request(
				'http://localhost/reflect?v=' + encodeURIComponent(crlf)
			)
		)

		expect(res.headers.has('x-injected')).toBe(false)
	})

	it('a throwing .error() hook degrades to 500 instead of rejecting', async () => {
		const app = new Elysia()
			.error(() => {
				throw new Error('hook throws')
			})
			.get('/', () => {
				throw new Error('boom')
			})

		const res = await app.handle(new Request('http://localhost/'))
		expect(res.status).toBe(500)
	})
})

// describe('response dispatch ignores a spoofed constructor.name', () => {
// 	it('treats a body-owned constructor.name as ordinary JSON data', async () => {
// 		const app = new Elysia().post('/echo', ({ body }) => body)

// 		for (const spoof of ['Response', 'String', 'Promise', 'Function']) {
// 			const res = await app.handle(
// 				new Request('http://e.ly/echo', {
// 					method: 'POST',
// 					headers: { 'content-type': 'application/json' },
// 					body: JSON.stringify({ constructor: { name: spoof }, x: 1 })
// 				})
// 			)
// 			expect(res.status).toBe(200)
// 			await expect(res.json()).resolves.toEqual({
// 				constructor: { name: spoof },
// 				x: 1
// 			})
// 		}
// 	})
// })

describe('production 422 does not echo the request body', () => {
	it('redacts submitted values while retaining the invalid property path', async () => {
		const prev = process.env.NODE_ENV
		process.env.NODE_ENV = 'production'
		try {
			const app = new Elysia().post(
				'/login',
				{ body: t.Object({ n: t.Number() }) },
				({ body }) => body
			)
			const res = await app.handle(
				new Request('http://e.ly/login', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ password: 'secret-pw', n: 'x' })
				})
			)
			const body: any = await res.json()
			expect(res.status).toBe(422)
			expect(body.property).toBe('/n')
			expect(body.found).toBeUndefined()
			expect(JSON.stringify(body)).not.toContain('secret-pw')
		} finally {
			process.env.NODE_ENV = prev
		}
	})
})

describe('macro seed dedup is collision-safe', () => {
	it('throws a clear error for a circular seed value', () => {
		const withMacro = new Elysia().macro({
			auth: () => ({ beforeHandle() {} })
		})
		const circular: any = {}
		circular.self = circular

		expect(() =>
			new Elysia()
				.use(withMacro)
				.get('/', { auth: circular } as any, () => 'x')
				['fetch'].toString()
		).toThrow(/circular seed/)
	})

	it('runs hooks for distinct function-valued seeds', async () => {
		// JSON.stringify drops both functions, so identity must distinguish them.
		const ran: string[] = []
		const app = new Elysia()
			.macro({
				check: (v: any) => ({
					beforeHandle() {
						v.fn()
					}
				}),
				wrapper: () => ({ check: { fn: () => ran.push('A') } })
			})
			.get(
				'/x',
				{ wrapper: true, check: { fn: () => ran.push('B') } } as any,
				() => 'ok'
			)

		await app.handle(new Request('http://e.ly/x'))
		expect(ran.sort()).toEqual(['A', 'B'])
	})

	it('deduplicates an identical seed so its hook runs once', async () => {
		let count = 0
		const app = new Elysia()
			.macro({
				check: () => ({
					beforeHandle() {
						count++
					}
				}),
				wrapper: () => ({ check: { role: 'admin' } })
			})
			.get(
				'/x',
				{ wrapper: true, check: { role: 'admin' } } as any,
				() => 'ok'
			)

		await app.handle(new Request('http://e.ly/x'))
		expect(count).toBe(1)
	})
})

describe('cookie name/attributes reject injection chars', () => {
	it('rejects separators while allowing a valid cookie', async () => {
		const { serialize } = await import('../../src/cookie/lib')
		expect(() => serialize('a;b', 'v', {})).toThrow(/Invalid cookie name/)
		expect(() => serialize('ok', 'v', { path: '/a; Secure' })).toThrow(
			/Invalid cookie Path/
		)
		expect(serialize('sid', 'abc', { path: '/' })).toContain('sid=abc')
	})
})

describe('the last-resort 500 never throws', () => {
	it('handles circular causes and throwing message getters', async () => {
		const { internalServerErrorResponse } = await import('../../src/error')

		const circular: any = new Error('boom')
		circular.cause = {}
		circular.cause.self = circular.cause

		const throwingGetter: any = new Error()
		Object.defineProperty(throwingGetter, 'message', {
			get() {
				throw new Error('getter boom')
			}
		})

		for (const e of [circular, throwingGetter]) {
			const res = internalServerErrorResponse(e)
			expect(res.status).toBe(500)
		}
	})
})
