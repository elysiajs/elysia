import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { signCookieSync, hasSyncHmac } from '../../src/cookie/crypto'

/**
 * Characterization tests for lazy cookie jar materialization (Plan 003).
 *
 * These encode the observable contract that must survive deferring per-name
 * entry build (and, in the unsigned/unvalidated lane, the decode) to first
 * access: reading ONE cookie of many yields identical behavior while only that
 * cookie is paid for; enumeration still sees every name; absent-cookie writes,
 * dirty-tracking (no spurious re-serialize), signed lazy verification, and
 * schema validation all keep working.
 *
 * Written BEFORE the change — run green against the unchanged implementation,
 * then must stay green after Stage A / Stage B.
 */

const many = [
	'session=abc123',
	'theme=dark',
	'prefs=%7B%22lang%22%3A%22en%22%7D', // {"lang":"en"}
	'list=%5B1%2C2%2C3%5D', // [1,2,3]
	'a=1',
	'b=2',
	'c=3',
	'd=4',
	'e=5',
	'f=6'
].join('; ')

function req(path: string, cookie?: string) {
	return new Request(`http://localhost${path}`, {
		headers: cookie ? { cookie } : {}
	})
}

for (const compiled of [true, false]) {
	const label = compiled ? 'compiled' : 'interpreted'
	const build = (app: Elysia<any, any>) => (compiled ? app.compile() : app)

	describe(`lazy cookie jar (${label})`, () => {
		it('reads one decoded cookie out of many', async () => {
			const app = build(
				new Elysia().get('/', ({ cookie }: any) => cookie.session.value)
			)

			const res = await app.handle(req('/', many))
			expect(res.status).toBe(200)
			expect(await res.text()).toBe('abc123')
		})

		it('JSON-decodes a read cookie value out of many', async () => {
			const app = build(
				new Elysia().get('/', ({ cookie }: any) => cookie.prefs.value)
			)

			const res = await app.handle(req('/', many))
			expect(res.status).toBe(200)
			expect(await res.json()).toEqual({ lang: 'en' })
		})

		it('enumerates every sent cookie name from the jar', async () => {
			const app = build(
				new Elysia().get('/', ({ cookie }: any) =>
					Object.keys(cookie).sort().join(',')
				)
			)

			const res = await app.handle(req('/', many))
			expect(await res.text()).toBe(
				'a,b,c,d,e,f,list,prefs,session,theme'
			)
		})

		it('creates an absent cookie when its value is written', async () => {
			const app = build(
				new Elysia().get('/', ({ cookie }: any) => {
					cookie.fresh.value = 'created'
					return 'ok'
				})
			)

			const res = await app.handle(req('/', many))
			expect(res.status).toBe(200)
			const header = decodeURIComponent(
				res.headers.get('set-cookie') ?? ''
			)
			expect(header).toContain('fresh=created')
		})

		it('does not re-serialize a JSON cookie read without modification', async () => {
			const app = build(
				new Elysia().get(
					'/',
					({ cookie }: any) => (cookie.prefs.value as any).lang
				)
			)

			const res = await app.handle(req('/', many))
			expect(await res.text()).toBe('en')
			// dirty-tracking: a pure read must not emit Set-Cookie
			expect(res.headers.getAll('set-cookie').length).toBe(0)
		})

		it('a t.Cookie schema sees decoded values and rejects invalid ones', async () => {
			const app = build(
				new Elysia().get(
					'/',
					{
						cookie: t.Cookie({
							prefs: t.Object({ lang: t.String() }),
							a: t.Numeric()
						})
					},
					({ cookie }: any) => `${cookie.prefs.value.lang}:${cookie.a.value}`
				)
			)

			const ok = await app.handle(req('/', many))
			expect(ok.status).toBe(200)
			expect(await ok.text()).toBe('en:1')

			// `prefs` present but wrong shape -> validation rejects
			const bad = await app.handle(
				req('/', 'prefs=%7B%22lang%22%3A5%7D; a=1') // {"lang":5}
			)
			expect(bad.status).toBe(422)
		})
	})
}

if (!hasSyncHmac) {
	describe('lazy signed-cookie jar without synchronous HMAC', () => {
		it('skipped', () => {})
	})
} else {
	const SECRET = 'lazy-jar-secret'
	const signed = (value: string) => signCookieSync(value, SECRET)

	for (const compiled of [true, false]) {
		const label = compiled ? 'compiled' : 'interpreted'
		const build = (app: Elysia<any, any>) =>
			compiled ? app.compile() : app

		describe(`lazy signed-cookie jar (${label})`, () => {
			it('resolves a valid signature on access, leaving siblings unread', async () => {
				const app = build(
					new Elysia({
						cookie: { secrets: SECRET, sign: ['sid'] }
					}).get('/', ({ cookie }: any) => cookie.sid.value)
				)

				const header = `sid=${signed('hello')}; other=garbage.nothmac`
				const res = await app.handle(req('/', header))
				expect(res.status).toBe(200)
				expect(await res.text()).toBe('hello')
			})

			it('verifies pending signatures when the jar is enumerated', async () => {
				const app = build(
					new Elysia({
						cookie: { secrets: SECRET, sign: ['sid'] }
					}).get('/', ({ cookie }: any) =>
						Object.keys(cookie).sort().join(',')
					)
				)

				// enumeration must trip verification of the bad signed cookie
				const res = await app.handle(
					req('/', 'sid=garbage.nothmac; plain=ok')
				)
				expect(res.status).toBe(400)
				const body = await res.json()
				expect(body.type).toBe('invalid-cookie')
			})
		})
	}
}
