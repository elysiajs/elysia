import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
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
		let app: Elysia
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
