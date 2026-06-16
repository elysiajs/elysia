import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'
import { req } from '../utils'
import { signCookie } from '../../src/cookie'

const secrets = 'We long for the seven wailings. We bear the koan of Jericho.'

const getCookies = (response: Response) =>
	// @ts-ignore
	response.headers.getAll('Set-Cookie').map((x) => {
		const value = decodeURIComponent(x)

		return value
	})

const app = new Elysia()
	.get(
		'/council',
		({ cookie: { council } }) =>
			(council.value = [
				{
					name: 'Rin',
					affilation: 'Administration'
				}
			]),
		{
			cookie: t.Cookie({
				council: t.Optional(
					t.Array(
						t.Object({
							name: t.String(),
							affilation: t.String()
						})
					)
				)
			})
		}
	)
	.get('/create', ({ cookie: { name } }) => (name.value = 'Himari'))
	.get('/multiple', ({ cookie: { name, president } }) => {
		name.value = 'Himari'
		president.value = 'Rio'

		return 'ok'
	})
	.get(
		'/update',
		({ cookie: { name } }) => {
			name.value = 'seminar: Himari'

			return name.value
		},
		{
			cookie: t.Cookie(
				{
					name: t.Optional(t.String())
				},
				{
					secrets,
					sign: ['name']
				}
			)
		}
	)
	.get('/remove', ({ cookie }) => {
		for (const self of Object.values(cookie)) self.remove()

		return 'Deleted'
	})
	.get('/remove-with-options', ({ cookie }) => {
		for (const self of Object.values(cookie)) self.remove()

		return 'Deleted'
	})
	.get('/set', ({ cookie: { session } }) => {
		session.value = 'rin'
		session.set({
			path: '/'
		})
	})

describe('Cookie Response', () => {
	it('set cookie', async () => {
		const response = await app.handle(req('/create'))

		expect(getCookies(response)).toEqual(['name=Himari; Path=/'])
	})

	it('set multiple cookie', async () => {
		const response = await app.handle(req('/multiple'))

		expect(getCookies(response)).toEqual([
			'name=Himari; Path=/',
			'president=Rio; Path=/'
		])
	})

	it('set JSON cookie', async () => {
		const response = await app.handle(req('/council'))

		expect(getCookies(response)).toEqual([
			'council=[{"name":"Rin","affilation":"Administration"}]; Path=/'
		])
	})

	it('write cookie on different value', async () => {
		const response = await app.handle(
			req('/council', {
				headers: {
					cookie:
						'council=' +
						encodeURIComponent(
							JSON.stringify([
								{
									name: 'Aoi',
									affilation: 'Financial'
								}
							])
						)
				}
			})
		)

		expect(getCookies(response)).toEqual([
			'council=[{"name":"Rin","affilation":"Administration"}]; Path=/'
		])
	})

	it('remove cookie', async () => {
		const response = await app.handle(
			req('/remove', {
				headers: {
					cookie:
						'council=' +
						encodeURIComponent(
							JSON.stringify([
								{
									name: 'Rin',
									affilation: 'Administration'
								}
							])
						)
				}
			})
		)

		expect(getCookies(response)[0]).toInclude(
			`council=; Max-Age=0; Path=/; Expires=${new Date(0).toUTCString()}`
		)
	})

	it('sign cookie', async () => {
		const response = await app.handle(req('/update'))

		expect(getCookies(response)).toEqual([
			`name=${await signCookie('seminar: Himari', secrets)}; Path=/`
		])
	})

	it('sign/unsign cookie', async () => {
		const response = await app.handle(
			req('/update', {
				headers: {
					cookie: `name=${await signCookie(
						'seminar: Himari',
						secrets
					)}`
				}
			})
		)

		expect(response.status).toBe(200)
	})

	it('inherits cookie settings', async () => {
		const app = new Elysia({
			cookie: {
				secrets,
				sign: ['name']
			}
		}).get(
			'/update',
			({ cookie: { name } }) => {
				if (!name.value) name.value = 'seminar: Himari'

				return name.value
			},
			{
				cookie: t.Cookie({
					name: t.Optional(t.String())
				})
			}
		)

		const response = await app.handle(
			req('/update', {
				headers: {
					cookie: `name=${await signCookie(
						'seminar: Himari',
						secrets
					)}`
				}
			})
		)

		expect(response.status).toBe(200)
	})

	it('sign all cookie', async () => {
		const app = new Elysia({
			cookie: {
				secrets,
				sign: true
			}
		}).get(
			'/update',
			({ cookie: { name } }) => {
				if (!name.value) name.value = 'seminar: Himari'

				return name.value
			},
			{
				cookie: t.Cookie({
					name: t.Optional(t.String())
				})
			}
		)

		const response = await app.handle(
			req('/update', {
				headers: {
					cookie: `name=${await signCookie(
						'seminar: Himari',
						secrets
					)}`
				}
			})
		)

		expect(response.status).toBe(200)
	})

	it('set cookie property from constructor', async () => {
		const app = new Elysia({
			cookie: {
				httpOnly: true,
				path: ''
			}
		}).get('/create', ({ cookie: { name } }) => (name.value = 'Himari'))

		const response = await app.handle(req('/create'))

		expect(response.headers.getAll('Set-Cookie')).toEqual([
			'name=Himari; Path=/; HttpOnly'
		])
	})

	it('retain cookie value when using set if not provided', async () => {
		const response = await app.handle(req('/set'))

		expect(response.headers.getAll('Set-Cookie')).toEqual([
			'session=rin; Path=/'
		])
	})

	it('parse object cookie', async () => {
		const app = new Elysia().get(
			'/council',
			({ cookie: { council } }) => council.value,
			{
				cookie: t.Cookie({
					council: t.Object({
						name: t.String(),
						affilation: t.String()
					})
				})
			}
		)

		const expected = {
			name: 'Rin',
			affilation: 'Administration'
		}

		const response = await app.handle(
			req('/council', {
				headers: {
					cookie: 'council=' + JSON.stringify(expected)
				}
			})
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual(expected)
	})

	it('handle optional at root', async () => {
		const app = new Elysia().get('/', ({ cookie: { id } }) => id.value, {
			cookie: t.Optional(
				t.Object({
					id: t.Numeric()
				})
			)
		})

		const res = await Promise.all([
			app.handle(req('/')).then((x) => x.text()),
			app
				.handle(
					req('/', {
						headers: {
							cookie: 'id=1'
						}
					})
				)
				.then((x) => x.text())
		])

		expect(res).toEqual(['', '1'])
	})

	it("don't set cookie if new value is undefined", async () => {
		const app = new Elysia().get('/', ({ cookie: { id } }) => {
			id.value = undefined

			return 'a'
		})

		const res = app.handle(req('/')).then((x) => x.headers.toJSON())

		// @ts-expect-error
		expect(res).toEqual({})
	})

	it('set cookie attribute before value', async () => {
		const date = new Date(Date.now() + 1000 * 60 * 60 * 24)

		const app = new Elysia().get('/', ({ cookie }) => {
			cookie.my_cookie.expires = date
			cookie.my_cookie.value = 'my_cookie_value'

			return 'HI'
		})

		const setCookie = await app
			.handle(new Request('http://localhost'))
			.then((x) => x.headers.getSetCookie())

		expect(setCookie).toEqual([
			`my_cookie=my_cookie_value; Path=/; Expires=${date.toUTCString()}`
		])
	})

	it('should not set if value is duplicated', async () => {
		const app = new Elysia()
			.derive(({ cookie: { test } }) => {
				if (!test.value) {
					test.value = 'Hello, world!'
				}

				return {}
			})
			.get('/', () => 'Hello, world!')

		const res = await app
			.handle(
				new Request('http://localhost:3000/', {
					headers: {
						cookie: 'test=Hello, world!'
					}
				})
			)
			.then((x) => x.headers)

		expect(res.getSetCookie()).toEqual([])
	})

	// Regression (perf audit F2): buildCookieJar memoizes Cookie instances
	// per request jar — repeated accesses return the same instance so
	// change-detection state survives across accesses
	it('memoizes Cookie instances per request jar', async () => {
		const app = new Elysia().get('/identity', ({ cookie }) => ({
			same: cookie.session === cookie.session,
			distinct: cookie.session !== cookie.other
		}))

		const response = await app.handle(
			req('/identity', {
				headers: {
					cookie: 'session=a'
				}
			})
		)

		expect(await response.json()).toEqual({
			same: true,
			distinct: true
		})
	})

	// Regression (perf audit F2): request-cookie store entries (defaults
	// already merged at parse) are now passed to Cookie by reference instead
	// of re-merged per access — an attribute-only write must keep emitting
	// the exact same Set-Cookie bytes
	it('set cookie attribute only on a request cookie', async () => {
		const app = new Elysia().get('/attr', ({ cookie: { session } }) => {
			session.domain = 'elysiajs.com'

			return 'ok'
		})

		const response = await app.handle(
			req('/attr', {
				headers: {
					cookie: 'session=a'
				}
			})
		)

		expect(getCookies(response)).toEqual([
			'session=a; Domain=elysiajs.com; Path=/'
		])
	})

	it('signs a cookie set before a thrown-then-handled error', async () => {
		const app = new Elysia()
			// A handler returning from `error()` is still a response — the
			// cookie it set before throwing must go out SIGNED, not raw.
			.error(() => 'handled')
			.get(
				'/boom',
				({ cookie: { name } }) => {
					name.value = 'seminar: Himari'

					throw new Error('boom')
				},
				{
					cookie: t.Cookie(
						{ name: t.Optional(t.String()) },
						{ secrets, sign: ['name'] }
					)
				}
			)

		const response = await app.handle(req('/boom'))

		expect(await response.text()).toBe('handled')
		expect(getCookies(response)).toEqual([
			`name=${await signCookie('seminar: Himari', secrets)}; Path=/`
		])
	})
})
