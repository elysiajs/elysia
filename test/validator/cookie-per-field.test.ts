import { describe, expect, it } from 'bun:test'
import { Elysia, t, InvalidCookieSignature } from '../../src'
import { signCookie } from '../../src/cookie'
import { req } from '../utils'

describe('Cookie Per-field Configuration', () => {
	it('auto-signs a field that has its own secrets', async () => {
		const secret = 'Fischl von Luftschloss Narfidort'

		const app = new Elysia().get(
			'/',
			({ cookie: { token } }) => {
				token.value = 'session-id'
				return token.value
			},
			{
				cookie: t.Object({
					token: t.Cookie(t.Optional(t.String()), {
						secrets: secret
					})
				})
			}
		)

		const response = await app.handle(req('/'))
		const setCookie = response.headers.get('set-cookie')!

		expect(response.status).toBe(200)
		expect(setCookie).toInclude(`token=${await signCookie('session-id', secret)}`)
	})

	it('round-trips a signed per-field cookie', async () => {
		const secret = 'Fischl von Luftschloss Narfidort'

		const app = new Elysia().get(
			'/',
			({ cookie: { token } }) => token.value,
			{
				cookie: t.Object({
					token: t.Cookie(t.Optional(t.String()), {
						secrets: secret
					})
				})
			}
		)

		const signed = await signCookie('session-id', secret)
		const response = await app.handle(
			req('/', { headers: { cookie: `token=${signed}` } })
		)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('session-id')
	})

	it('rejects a tampered signature on a per-field signed cookie', async () => {
		const secret = 'Fischl von Luftschloss Narfidort'

		const app = new Elysia()
			.error(({ error }) => {
				// `code` was removed this version; dispatch via instanceof.
				if (error instanceof InvalidCookieSignature)
					return new Response('bad-sig', { status: 401 })
				throw error
			})
			.get(
				'/',
				({ cookie: { token } }) => token.value,
				{
					cookie: t.Object({
						token: t.Cookie(t.String(), { secrets: secret })
					})
				}
			)

		const response = await app.handle(
			req('/', { headers: { cookie: 'token=session-id.bogus-signature' } })
		)

		expect(response.status).toBe(401)
		expect(await response.text()).toBe('bad-sig')
	})

	it('applies per-field attribute overrides only to the targeted field', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie: { a, b } }) => {
				a.value = 'x'
				b.value = 'y'
				return 'ok'
			},
			{
				cookie: t.Object({
					a: t.Cookie(t.Optional(t.String()), { maxAge: 60 }),
					b: t.Optional(t.String())
				})
			}
		)

		const response = await app.handle(req('/'))
		const setCookies = response.headers.getSetCookie()

		expect(response.status).toBe(200)
		expect(setCookies).toContain('a=x; Max-Age=60; Path=/')
		expect(setCookies).toContain('b=y; Path=/')
	})

	it('per-field maxAge wins over object-level default', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie: { name } }) => {
				name.value = 'hello'
				return 'ok'
			},
			{
				cookie: t.Cookie(
					{
						name: t.Cookie(t.Optional(t.String()), { maxAge: 60 })
					},
					{ maxAge: 30 }
				)
			}
		)

		const response = await app.handle(req('/'))
		const setCookie = response.headers.get('set-cookie')!

		expect(response.status).toBe(200)
		expect(setCookie).toInclude('Max-Age=60')
		expect(setCookie).not.toInclude('Max-Age=30')
	})

	it('per-field secrets win over global app-level secrets', async () => {
		const fieldSecret = 'field-only'
		const appSecret = 'app-default'

		const app = new Elysia({ cookie: { secrets: appSecret } }).get(
			'/',
			({ cookie: { token } }) => {
				token.value = 'data'
				return token.value
			},
			{
				cookie: t.Object({
					token: t.Cookie(t.Optional(t.String()), {
						secrets: fieldSecret
					})
				})
			}
		)

		const response = await app.handle(req('/'))
		const setCookie = decodeURIComponent(
			response.headers.get('set-cookie')!
		)

		expect(response.status).toBe(200)
		expect(setCookie).toInclude(
			`token=${await signCookie('data', fieldSecret)}`
		)
	})
})
