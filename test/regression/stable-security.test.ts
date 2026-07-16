// Each security regression proves the exploit no longer fires and valid input
// still works.
import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { Numeric } from '../../src/type/elysia/numeric'
import { Value } from 'typebox/value'

describe('t.Numeric regex is linear, not catastrophic', () => {
	it('validates a 200KB adversarial all-digit-then-nondigit string in <5ms', () => {
		const schema = Numeric()
		const attack = '9'.repeat(200_000) + 'x'

		const start = performance.now()
		// invalid input must reject, and do so linearly
		expect(Value.Check(schema, attack)).toBe(false)
		const elapsed = performance.now() - start

		expect(elapsed).toBeLessThan(5)
	})

	it('parity: still accepts/rejects the canonical decimal forms', () => {
		const schema = Numeric()
		for (const ok of ['0', '123', '-1', '1.5', '.5', '12.', '+.5'])
			expect(Value.Check(schema, ok)).toBe(true)
		for (const bad of ['', 'abc', '1e3', '0x10', '1.2.3', '--1'])
			expect(Value.Check(schema, bad)).toBe(false)
	})
})

describe('a CRLF-poisoned header never escapes app.handle', () => {
	const crlf = 'foo\r\nx-injected: pwned'

	it('reflected CRLF value → clean response, no split, process survives', async () => {
		const app = new Elysia().get('/reflect', ({ query, set }) => {
			set.headers['x-echo'] = query.v ?? ''
			return 'ok'
		})

		const res = await app.handle(
			new Request(
				'http://localhost/reflect?v=' + encodeURIComponent(crlf)
			)
		)

		// never throws out of app.handle; no header split
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


describe('response dispatch ignores a spoofed constructor.name', () => {
	it('a client-echoed {constructor:{name}} is treated as a plain object (no 500, no corruption)', async () => {
		const app = new Elysia().post('/echo', ({ body }) => body)

		for (const spoof of ['Response', 'String', 'Promise', 'Function']) {
			const res = await app.handle(
				new Request('http://e.ly/echo', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ constructor: { name: spoof }, x: 1 })
				})
			)
			expect(res.status).toBe(200)
			await expect(res.json()).resolves.toEqual({
				constructor: { name: spoof },
				x: 1
			})
		}
	})
})

describe('production 422 does not echo the request body', () => {
	it('prod redacts `found`; property still names the field', async () => {
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
	it('a circular seed value fails loud instead of crashing opaquely', () => {
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

	it('two distinct function-bearing seeds do NOT collide (both hooks run)', async () => {
		// `{ fn: a }` and `{ fn: b }` both JSON.stringify to `{}` (functions
		// dropped) — the old key dropped the second, potentially an auth hook.
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

	it('a repeated identical seed still dedups (hook runs once)', async () => {
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

//  (t.File({ type }) throws at construction without a detector)
// is proven indirectly by test/validator/file-type-queue.test.ts, which now
// MUST register a detector in beforeAll or its `t.File({ type })` schemas throw.
// A direct in-suite pin is not reliable: the detector is a process global with
// no reset API, and other suites set it, so the no-detector state can't be
// guaranteed here.

describe('.listen options object is not mutated', () => {
	it('reusing one options object across two apps leaks nothing onto it', () => {
		const options: Record<string, unknown> = { port: 0 }

		const a = new Elysia().get('/a', () => 'a').listen(options)
		const b = new Elysia().get('/b', () => 'b').listen(options)

		try {
			// the fix spreads `{ ...options }` per listen, so the caller's object
			// never receives `fetch`/`routes`/`websocket` from either app
			expect('fetch' in options).toBe(false)
			expect('routes' in options).toBe(false)
		} finally {
			;(a as any).stop?.()
			;(b as any).stop?.()
		}
	})
})

describe('cookie name/attributes reject injection chars', () => {
	it('a cookie name with a separator throws', async () => {
		const { serialize } = await import('../../src/cookie/lib')
		expect(() => serialize('a;b', 'v', {})).toThrow(/Invalid cookie name/)
		expect(() => serialize('ok', 'v', { path: '/a; Secure' })).toThrow(
			/Invalid cookie Path/
		)
		// a normal cookie still serializes
		expect(serialize('sid', 'abc', { path: '/' })).toContain('sid=abc')
	})
})

describe('the last-resort 500 never throws', () => {
	it('a circular cause and a throwing getter both degrade to a clean 500', async () => {
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
