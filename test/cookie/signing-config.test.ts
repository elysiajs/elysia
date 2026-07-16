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
			expect(true).toBe(true)
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
			expect(true).toBe(true)
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
