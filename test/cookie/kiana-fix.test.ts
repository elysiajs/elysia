import { describe, expect, it } from 'bun:test'

import { Elysia, t, problem } from '../../src'
import { compileCookieConfig } from '../../src/cookie/config'
import {
	buildCookieJar,
	parseCookieRaw,
	signCookieValues
} from '../../src/cookie/utils'

// Regression (kiana idx3/idx24/idx38): a cookie declared signed with NO usable
// secret used to silently degrade to plaintext — the config validator only
// guarded `secrets === undefined`, so scalar `null` / all-null arrays slipped
// through. signed:true was reported, the write path emitted an UNSIGNED cookie
// (silent `continue`), and the read path returned the raw signature-suffixed
// value UNVERIFIED. A forged "signed" auth cookie was accepted. WHY it matters:
// signing is a trust-bearing security boundary; a no-op signer must fail loud
// at config time, never silently accept forgery. Policy: a field declared
// signed with no usable secret throws.
describe('cookie sign with no usable secret fails loud (idx3/24/38)', () => {
	it('rejects a global { sign: true, secrets: null } config at compile', () => {
		// undefined was already guarded; null must be treated the same
		expect(() => compileCookieConfig(undefined, { sign: true })).toThrow()
		expect(() =>
			compileCookieConfig(undefined, { sign: true, secrets: null })
		).toThrow()
	})

	it('rejects an all-null secrets array (only the "allow unsigned" slot)', () => {
		expect(() =>
			compileCookieConfig(undefined, { sign: true, secrets: [null] })
		).toThrow()
	})

	it('rejects a per-field signed cookie whose secret resolves to null', () => {
		const schema = {
			config: { sign: ['token'] },
			properties: {
				// field declares its own null secret AND there is no global one
				token: { config: { sign: true, secrets: null } }
			}
		}

		expect(() => compileCookieConfig(schema as any, undefined)).toThrow()
	})

	it('still accepts a rotation list with at least one real key (graceful transition)', () => {
		// ['real', null] is the documented graceful-transition form — the null
		// is the "allow unsigned" slot, the string is a usable key, so it stays
		// valid and must NOT throw
		expect(() =>
			compileCookieConfig(undefined, {
				sign: true,
				secrets: ['real-secret', null]
			})
		).not.toThrow()
	})

	it('end-to-end: a signed-with-null-secret app does not silently accept a forged cookie', async () => {
		// Before the fix this returned 200 with the forged value; now the
		// misconfiguration is rejected — construction throws, the request
		// rejects, or it errors out, but it must NEVER return a successful 200
		// echoing the forged value.
		let app: any
		try {
			app = new Elysia({
				cookie: { sign: true, secrets: null }
			}).get('/', ({ cookie }) => ({ token: cookie.token.value }))
		} catch {
			// rejected at registration — the desired fail-loud outcome
			expect(true).toBe(true)
			return
		}

		// construction was lazy: the forged value must not come back as a 200
		let status = 0
		let body = ''
		try {
			const res = await app.handle(
				new Request('http://localhost/', {
					headers: { cookie: 'token=admin' }
				})
			)
			status = res.status
			body = await res.text()
		} catch {
			// rejected at request time — also fail-loud, acceptable
			expect(true).toBe(true)
			return
		}

		expect(status === 200 && body.includes('admin')).toBe(false)
	})

	it('read path never returns a signature-suffixed value unverified (idx24 defensive)', async () => {
		// Hand-built config that bypasses compile-time validation: a signed
		// field whose resolved secret is scalar null. The read path used to
		// enter the verify block, match neither branch, and return the forged
		// value AS-IS. It must now fail loud instead.
		const config = {
			defaults: { path: '/' },
			fields: {},
			globalSign: true as const,
			globalSecrets: null,
			hasSign: true
		}

		await expect(
			parseCookieRaw('token=forged.fakesig', config as any)
		).rejects.toThrow()
	})

	it('write path never emits an unsigned cookie for a signed field (idx38 defensive)', () => {
		// Hand-built config: signed but the only secret slot is null. The write
		// path used to `continue` and ship the value unsigned; it must throw.
		const config = {
			defaults: { path: '/' },
			fields: {},
			globalSign: true as const,
			globalSecrets: [null],
			hasSign: true
		}

		const cookies = { token: { value: 'secret-data' } }

		expect(() => signCookieValues(cookies as any, config as any)).toThrow()
	})
})

// Regression (kiana idx31): buildCookieJar copied config.defaults into each
// per-request store entry with a shallow Object.assign, so an object-valued
// attribute (`expires`, a Date) was shared BY REFERENCE with the
// registration-time default. A handler mutating cookie.expires IN PLACE
// corrupted the shared default for every later request. WHY it matters: cookie
// config is captured once at registration and reused across all requests on the
// route — a per-request handler must never be able to leak state into a sibling
// request via a shared Date.
describe('per-request cookie defaults are isolated (idx31)', () => {
	it('in-place mutation of cookie.expires does not corrupt the shared default', () => {
		const shared = new Date('2030-01-01T00:00:00.000Z')
		const config = compileCookieConfig(undefined, { expires: shared })

		const set1 = { headers: {}, cookie: {} }
		const jar1 = buildCookieJar(set1, { session: 'a' }, config) as any

		// in-place Date mutation by a handler in request 1
		jar1.session.expires.setUTCFullYear(1999)

		// request 2 is a separate jar built from the SAME shared config
		const set2 = { headers: {}, cookie: {} }
		const jar2 = buildCookieJar(set2, { session: 'b' }, config) as any

		expect(jar2.session.expires.getUTCFullYear()).toBe(2030)
		// and the registration-time default itself stays pristine
		expect(config.defaults.expires!.getUTCFullYear()).toBe(2030)
		expect(shared.getUTCFullYear()).toBe(2030)
	})
})

// Regression (kiana idx46): when both app- and route-level attributes are
// present, compileCookieConfig used to recompute getAttributes twice in the
// merge spread. The cleanup reuses the precomputed vars — pin that the merged
// defaults are still correct (route attribute wins over app, both survive).
describe('app + route attribute merge stays correct (idx46)', () => {
	it('merges app and route cookie attributes with route winning', () => {
		const schema = { config: { path: '/route', httpOnly: false } }
		const config = compileCookieConfig(schema as any, {
			path: '/app',
			httpOnly: true,
			domain: 'example.com'
		})

		// route overrides path + httpOnly; app-only domain survives
		expect(config.defaults.path).toBe('/route')
		expect(config.defaults.httpOnly).toBe(false)
		expect(config.defaults.domain).toBe('example.com')
	})
})

// Regression (codex-indep-5): when a handler reassigns `set.headers` to a native
// `Headers` INSTANCE and sets exactly ONE cookie, `handleSet` wrote the cookie
// with a bracket property assignment (`set.headers['set-cookie'] = string`). A
// `Headers` instance has no property setter — the bracket write created an inert
// own JS property the `Response` header iterator never reads, so the single
// cookie was SILENTLY DROPPED (getSetCookie().length === 0). Two+ cookies
// survived only because they took the string[] rebuild path (parseSetCookies via
// .append). WHY it matters: a lost session/auth cookie is a silent correctness
// failure with no error and no log — the handler sees the cookie "set" but it
// never reaches the wire. The fix registers cookies via .append on a Headers
// instance (append, not set, to preserve multiple set-cookie), and never
// wrong-values or overwrites a user header (fails closed).
describe('cookie survives a Headers-instance set.headers (codex-indep-5)', () => {
	it('one cookie via the jar + Headers set.headers is not dropped', async () => {
		const app = new Elysia().get('/', ({ set, cookie }) => {
			set.headers = new Headers() as any
			cookie.session.value = 'abc123'
			return 'ok'
		})

		const res = await app.handle(new Request('http://localhost/'))
		// before the fix this was 0
		expect(res.headers.getSetCookie().length).toBe(1)
		expect(res.headers.getSetCookie()[0]).toContain('session=abc123')
	})

	it('two cookies via the jar + Headers set.headers both survive (no doubling)', async () => {
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

	it('set.cookie assigned directly + Headers set.headers survives', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers = new Headers() as any
			set.cookie = { session: { value: 'abc123' } } as any
			return 'ok'
		})

		const res = await app.handle(new Request('http://localhost/'))
		// before the fix this was 0
		expect(res.headers.getSetCookie().length).toBe(1)
		expect(res.headers.getSetCookie()[0]).toContain('session=abc123')
	})

	it('plain-object set.headers is unaffected (1 and 2 cookies)', async () => {
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

	it("a user's own .set() header on the Headers instance survives alongside the cookie", async () => {
		const app = new Elysia().get('/', ({ set, cookie }) => {
			set.headers = new Headers() as any
			// a security-relevant header the user set explicitly
			;(set.headers as unknown as Headers).set('authorization', 'Bearer xyz')
			cookie.session.value = 'abc123'
			return 'ok'
		})

		const res = await app.handle(new Request('http://localhost/'))
		// no user header is dropped (fails closed, never wrong-valued)
		expect(res.headers.get('authorization')).toBe('Bearer xyz')
		expect(res.headers.getSetCookie().length).toBe(1)
	})

	it('a user-set content-type on the Headers instance is not overwritten', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers = new Headers() as any
			;(set.headers as unknown as Headers).set('content-type', 'text/custom')
			return 'body'
		})

		const res = await app.handle(new Request('http://localhost/'))
		expect(res.headers.get('content-type')).toBe('text/custom')
	})

	it('a pre-existing set-cookie on the Headers instance is preserved additively', async () => {
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

	it('framework problem() content-type survives on a Headers-instance set.headers', async () => {
		// problem() constructs an ElysiaStatus carrying { content-type:
		// application/problem+json }. Object.assign onto a Headers instance wrote
		// inert properties, dropping it → the RFC9457 body was served as plain
		// application/json. The fix assigns status headers via .set on a Headers
		// instance.
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

	// (codex-indep-5, boundary rework) A returned streaming Response is merged
	// with `set` via responseToSetHeaders/createResponseHandler. That path did
	// Object.assign / bracket writes into `set.headers`; on a `Headers` instance
	// those writes were inert, so the returned Response's OWN headers (x-source,
	// content-type) were dropped and the merge silently lost data. Normalizing
	// the `Headers` instance to a Record at the boundary makes the merge work.
	it('returned streaming Response headers merge into a user Headers set.headers', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers = new Headers({ 'x-set': 'from-set' }) as any
			// force the merge path (a bare-Headers set with no status/cookie is
			// returned raw; a touched status routes through handleSet + merge)
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
		// the returned Response's own headers survive the merge
		expect(res.headers.get('x-source')).toBe('from-response')
		expect(res.headers.get('content-type')).toBe('text/custom')
		// and the user's set.headers entry survives too
		expect(res.headers.get('x-set')).toBe('from-set')
	})

	// (codex-indep-5, boundary rework) The default 404 handler bracket-wrote
	// `content-type` onto `set.headers`. When a request-level hook assigned a
	// `Headers` instance, that write was inert → the RFC9457 problem+json
	// content-type was silently dropped (served as null / octet-stream), while
	// the hook's own header (x-foo) survived because the Response was built from
	// the raw Headers instance. Normalizing at handleSet fixes the content-type.
	it('404 with a Headers-instance set.headers keeps hook header AND problem+json content-type', async () => {
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

	// (codex-indep-5, boundary rework) A user Headers instance carrying TWO
	// set-cookie values (via .append) must have BOTH survive normalization —
	// getSetCookie() (not the comma-joined single-header iterator value) is the
	// only correct way to extract multi-value set-cookie from a Headers instance.
	it('a user Headers instance with two appended set-cookie preserves both', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			const headers = new Headers()
			headers.append('set-cookie', 'a=1; Path=/')
			headers.append('set-cookie', 'b=2; Path=/')
			set.headers = headers as any
			// touch status so the response routes through handleSet
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

// Regression (011): jit.ts cookie header source selection.
//
// The guard is `hasHeaders && !vali?.headers`:
//   - headers-SCHEMA routes: vali?.headers is truthy → guard is false →
//     jit falls back to c.request.headers.get('cookie'). This is REQUIRED
//     because the headers validator (vali.headers.From()) strips non-schema
//     keys from c.headers before the cookie block runs; relying on the dict
//     would yield undefined for the cookie key even when a Cookie header is
//     present.
//   - schema-LESS routes that destructure `headers` (sucrose-inferred):
//     hasHeaders=true AND vali?.headers is falsy → guard is true →
//     jit emits c.headers['cookie'] (dict read, no extra Headers.get() cost).
//
// The two existing tests pin the headers-schema → .get() fallback path.
// The third test pins the schema-less inferred-headers → dict-read path.
describe("jit cookie header source: schema routes use .get() fallback, schema-less use dict read (011)", () => {
	it('headers-schema route + cookie access and NO Cookie header → empty jar, no 500', async () => {
		// vali?.headers is truthy → guard false → c.request.headers.get('cookie').
		// parseCookieRawSync treats falsy header identical to null → empty object.
		const app = new Elysia().get(
			'/',
			{ headers: t.Object({ 'x-token': t.Optional(t.String()) }) },
			({ cookie }) => Object.keys(cookie).length
		)

		const res = await app.handle(new Request('http://localhost/'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('0')
	})

	it('headers-schema route + cookie access WITH Cookie header → jar populated via .get() fallback', async () => {
		// vali?.headers is truthy → guard false → .get() path; cookie must still work.
		const app = new Elysia().get(
			'/',
			{ headers: t.Object({ 'x-token': t.Optional(t.String()) }) },
			({ cookie }) => cookie.session.value ?? ''
		)

		const res = await app.handle(
			new Request('http://localhost/', {
				headers: { cookie: 'session=hello' }
			})
		)
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('hello')
	})

	it("schema-less route with destructured headers reads cookie via dict (pins c.headers['cookie'] branch)", async () => {
		// `headers` is destructured → sucrose sets hasHeaders=true; no headers
		// validator → vali?.headers is falsy → guard `hasHeaders && !vali?.headers`
		// is true → jit emits c.headers['cookie'] instead of .get().
		// Pins the dict-read branch — fails if headers materialisation stops
		// including the cookie key or the guard regresses.
		const app = new Elysia().get(
			'/',
			({ headers, cookie }) => cookie.session?.value ?? 'none'
		)

		const withCookie = await app.handle(
			new Request('http://localhost/', {
				headers: { cookie: 'session=hello' }
			})
		)
		expect(withCookie.status).toBe(200)
		expect(await withCookie.text()).toBe('hello')

		const noCookie = await app.handle(new Request('http://localhost/'))
		expect(noCookie.status).toBe(200)
		expect(await noCookie.text()).toBe('none')
	})
})
