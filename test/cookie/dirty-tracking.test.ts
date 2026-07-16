import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { signCookie } from '../../src/cookie/utils'

const jsonCookie = (name: string, value: unknown) =>
	`${name}=${encodeURIComponent(JSON.stringify(value))}`

// dirtiness is decided at serialize time against the raw parse string,
// so in-place mutation of an object cookie (which never assigns `.value`)
// must still emit Set-Cookie — silently dropping the write is data loss.
describe('Cookie - serialize-time dirty tracking', () => {
	it('emits Set-Cookie for pure in-place mutation', async () => {
		const app = new Elysia().post('/bump', ({ cookie: { data } }) => {
			;(data.value as { count: number }).count++
			return 'ok'
		})

		const res = await app.handle(
			new Request('http://localhost/bump', {
				method: 'POST',
				headers: { cookie: jsonCookie('data', { count: 1 }) }
			})
		)

		const header = res.headers.get('set-cookie')
		expect(header).toBeTruthy()
		expect(decodeURIComponent(header!)).toContain('{"count":2}')
	})

	it('emits Set-Cookie for mutate-and-reassign of the same reference', async () => {
		const app = new Elysia().post('/bump', ({ cookie: { data } }) => {
			const v = data.value as { count: number }
			v.count++
			data.value = v
			return 'ok'
		})

		const res = await app.handle(
			new Request('http://localhost/bump', {
				method: 'POST',
				headers: { cookie: jsonCookie('data', { count: 1 }) }
			})
		)

		expect(decodeURIComponent(res.headers.get('set-cookie')!)).toContain(
			'{"count":2}'
		)
	})

	it('does not emit for read-only access to an object cookie', async () => {
		const app = new Elysia().get(
			'/read',
			({ cookie: { data } }) => (data.value as { count: number }).count
		)

		const res = await app.handle(
			new Request('http://localhost/read', {
				headers: { cookie: jsonCookie('data', { count: 5 }) }
			})
		)

		expect(res.headers.getAll('set-cookie').length).toBe(0)
		expect(await res.text()).toBe('5')
	})

	// attribute changes don't alter the value, so the raw-string dirty check
	// must not swallow them
	it('emits when only a cookie attribute changes on an unchanged value', async () => {
		const app = new Elysia().get('/attr', ({ cookie: { data } }) => {
			data.path = '/x'
			return 'ok'
		})

		const res = await app.handle(
			new Request('http://localhost/attr', {
				headers: { cookie: jsonCookie('data', { k: 1 }) }
			})
		)

		expect(res.headers.get('set-cookie')).toContain('Path=/x')
	})

	// a bare/malformed % must fall back to the raw string instead of
	// silently becoming undefined (data loss)
	it('falls back to the raw string on malformed percent-encoding', async () => {
		const app = new Elysia().get(
			'/m',
			({ cookie: { v } }) => v.value ?? 'MISSING'
		)

		const res = await app.handle(
			new Request('http://localhost/m', {
				headers: { cookie: 'v=100%' }
			})
		)

		expect(await res.text()).toBe('100%')
	})
})

// the whole dirty-tracking contract above uses the NO-schema path.
// Under a cookie SCHEMA the value getter received a FRESH validated object that
// was never a `rawJsonValue` WeakMap key, so `~raw` was absent, the getter's
// registration branch (cookie.ts, gated on `'~raw' in cookie`) never fired, and
// an in-place mutation of an object cookie was SILENTLY DROPPED (no Set-Cookie)
// — the exact data loss this suite exists to prevent, but invisible to it
// because no case declared a schema. The schema is the *recommended* production
// pattern, so this hit real apps (e.g. `session.count++`). The fix restamps
// `~raw` on validated object cookies at the jar boundary so mutation emits while
// an unchanged/no-op read still suppresses (no over-emit). These pins cover the
// schema variant on both the JIT (`.compile()`) and lazy/interpreted paths.
describe('Cookie - dirty tracking under a schema', () => {
	const schema = {
		cookie: t.Cookie({
			data: t.Optional(t.Object({ count: t.Number() }))
		})
	}

	const build = (compiled: boolean) => {
		const app = new Elysia()
			.get('/bump', schema, ({ cookie: { data } }: any) => {
				if (data.value) (data.value as { count: number }).count++
				return 'ok'
			})
			.get('/read', schema, ({ cookie: { data } }: any) =>
				String((data.value as { count: number })?.count)
			)
			.get('/noop', schema, ({ cookie: { data } }: any) => {
				const v = data.value as { count: number }
				if (v) v.count = v.count
				return 'ok'
			})
			.get('/reassign', schema, ({ cookie: { data } }: any) => {
				data.value = { count: 99 }
				return 'ok'
			})
		return compiled ? app.compile() : app
	}

	for (const compiled of [true, false]) {
		const tag = compiled ? 'JIT' : 'interpreted'

		it(`[${tag}] emits Set-Cookie for in-place mutation (was silently dropped)`, async () => {
			const app = build(compiled)
			const res = await app.handle(
				new Request('http://localhost/bump', {
					headers: { cookie: jsonCookie('data', { count: 1 }) }
				})
			)
			const header = res.headers.get('set-cookie')
			expect(header).toBeTruthy()
			expect(decodeURIComponent(header!)).toContain('{"count":2}')
		})

		it(`[${tag}] does NOT emit for read-only access (no over-emit)`, async () => {
			const app = build(compiled)
			const res = await app.handle(
				new Request('http://localhost/read', {
					headers: { cookie: jsonCookie('data', { count: 5 }) }
				})
			)
			expect(res.headers.getAll('set-cookie').length).toBe(0)
			expect(await res.text()).toBe('5')
		})

		it(`[${tag}] does NOT emit for a no-op mutation (count -> same count)`, async () => {
			const app = build(compiled)
			const res = await app.handle(
				new Request('http://localhost/noop', {
					headers: { cookie: jsonCookie('data', { count: 7 }) }
				})
			)
			expect(res.headers.getAll('set-cookie').length).toBe(0)
		})

		it(`[${tag}] emits for a reassigned .value`, async () => {
			const app = build(compiled)
			const res = await app.handle(
				new Request('http://localhost/reassign', {
					headers: { cookie: jsonCookie('data', { count: 1 }) }
				})
			)
			expect(decodeURIComponent(res.headers.get('set-cookie')!)).toContain(
				'{"count":99}'
			)
		})
	}

	// signed object cookie: mutation must re-sign+emit; an unchanged read must
	// suppress (the sign path also keys on `~raw`).
	const signApp = (compiled: boolean) => {
		const app = new Elysia({
			cookie: { secrets: 'sekret', sign: ['session'] }
		})
			.get(
				'/bump',
				{
					cookie: t.Cookie({
						session: t.Optional(t.Object({ count: t.Number() }))
					})
				},
				({ cookie: { session } }: any) => {
					if (session.value) session.value.count++
					return 'ok'
				}
			)
			.get(
				'/read',
				{
					cookie: t.Cookie({
						session: t.Optional(t.Object({ count: t.Number() }))
					})
				},
				({ cookie: { session } }: any) => String(session.value?.count)
			)
		return compiled ? app.compile() : app
	}

	for (const compiled of [true, false]) {
		const tag = compiled ? 'JIT' : 'interpreted'

		it(`[${tag}] signed object cookie: mutation re-signs and emits, read suppresses`, async () => {
			const signed = await signCookie(
				JSON.stringify({ count: 5 }),
				'sekret'
			)
			const cookie = 'session=' + encodeURIComponent(signed)

			const bump = await signApp(compiled).handle(
				new Request('http://localhost/bump', { headers: { cookie } })
			)
			expect(bump.status).toBe(200)
			expect(bump.headers.get('set-cookie')).toBeTruthy()

			const read = await signApp(compiled).handle(
				new Request('http://localhost/read', { headers: { cookie } })
			)
			expect(read.status).toBe(200)
			expect(read.headers.getAll('set-cookie').length).toBe(0)
		})
	}
})
