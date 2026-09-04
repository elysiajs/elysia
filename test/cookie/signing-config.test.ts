import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { compileCookieConfig } from '../../src/cookie/config'
import { parseCookieRaw, signCookieValues } from '../../src/cookie/utils'

describe('cookie signing configuration', () => {
	it('rejects global signing without a usable secret', () => {
		expect(() => compileCookieConfig(undefined, { sign: true })).toThrow()
		expect(() =>
			compileCookieConfig(undefined, { sign: true, secrets: null })
		).toThrow()
	})

	it('rejects a rotation list containing only null', () => {
		expect(() =>
			compileCookieConfig(undefined, { sign: true, secrets: [null] })
		).toThrow()
	})

	it('rejects an empty or whitespace-only secret at configuration', () => {
		// An empty secret does not disable signing — it produces a real
		// HMAC-SHA256 under a zero-length key, which is a public function, so
		// anyone can mint a valid cookie for any value. The realistic trigger is
		// a deployment slip (`COOKIE_SECRET=` present-but-empty in a `.env`, an
		// empty Kubernetes secret), which must fail loudly at boot exactly like
		// an unset variable already does.
		for (const secrets of ['', '   ', [''], [null, '']])
			expect(() =>
				compileCookieConfig(undefined, {
					sign: true,
					secrets: secrets as any
				})
			).toThrow(/`cookie.secrets`/)

		expect(() =>
			compileCookieConfig(undefined, {
				sign: true,
				secrets: 'real-secret'
			})
		).not.toThrow()
	})

	it('never signs with an empty secret inside a rotation list', () => {
		// `['', 'real']` has a usable secret so it boots, but the write side
		// always uses secrets[0] — which would be the zero-length key.
		const config = compileCookieConfig(undefined, {
			secrets: ['', 'real-secret'],
			sign: ['session']
		})

		expect(() =>
			signCookieValues({ session: { value: 'hello' } } as any, config)
		).toThrow('is signed but no `secrets` is provided')
	})

	it('rejects a signed field whose secret resolves to null', () => {
		const schema = {
			config: { sign: ['token'] },
			properties: {
				token: { config: { sign: true, secrets: null } }
			}
		}

		expect(() => compileCookieConfig(schema as any, undefined)).toThrow()
	})

	it('accepts a rotation list with a usable secret and null', () => {
		expect(() =>
			compileCookieConfig(undefined, {
				sign: true,
				secrets: ['real-secret', null]
			})
		).not.toThrow()
	})

	it('never accepts a forged cookie when signing has no usable secret', async () => {
		let app: any
		try {
			app = new Elysia({
				cookie: { sign: true, secrets: null }
			}).get('/', ({ cookie }) => ({ token: cookie.token.value }))
		} catch {
			// Throwing at construction is itself "never accepts a forged cookie"
			return
		}

		let status = 0
		let body = ''
		try {
			const response = await app.handle(
				new Request('http://localhost/', {
					headers: { cookie: 'token=admin' }
				})
			)
			status = response.status
			body = await response.text()
		} catch {
			// Throwing while handling is itself "never accepts a forged cookie"
			return
		}

		expect(status === 200 && body.includes('admin')).toBe(false)
	})

	it('rejects an invalid signed read even if validation was bypassed', async () => {
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

	it('rejects an unsigned write even if validation was bypassed', () => {
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
