import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'
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
		},
		({ cookie: { council } }) =>
			(council.value = [
				{
					name: 'Rin',
					affilation: 'Administration'
				}
			])
	)
	.get('/create', ({ cookie: { name } }) => (name.value = 'Himari'))
	.get('/multiple', ({ cookie: { name, president } }) => {
		name.value = 'Himari'
		president.value = 'Rio'

		return 'ok'
	})
	.get(
		'/update',
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
		},
		({ cookie: { name } }) => {
			name.value = 'seminar: Himari'

			return name.value
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
		const response = await app.handle('/create')

		expect(getCookies(response)).toEqual(['name=Himari; Path=/'])
	})

	it('set multiple cookie', async () => {
		const response = await app.handle('/multiple')

		expect(getCookies(response)).toEqual([
			'name=Himari; Path=/',
			'president=Rio; Path=/'
		])
	})

	it('set JSON cookie', async () => {
		const response = await app.handle('/council')

		expect(getCookies(response)).toEqual([
			'council=[{"name":"Rin","affilation":"Administration"}]; Path=/'
		])
	})

	it('write cookie on different value', async () => {
		const response = await app.handle('/council', {
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

		expect(getCookies(response)).toEqual([
			'council=[{"name":"Rin","affilation":"Administration"}]; Path=/'
		])
	})

	it('remove cookie', async () => {
		const response = await app.handle('/remove', {
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

		expect(getCookies(response)[0]).toInclude(
			`council=; Max-Age=0; Path=/; Expires=${new Date(0).toUTCString()}`
		)
	})

	it('sign cookie', async () => {
		const response = await app.handle('/update')

		expect(getCookies(response)).toEqual([
			`name=${await signCookie('seminar: Himari', secrets, 'name')}; Path=/`
		])
	})

	it('sign/unsign cookie', async () => {
		const response = await app.handle('/update', {
			headers: {
				cookie: `name=${await signCookie('seminar: Himari', secrets)}`
			}
		})

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
			{
				cookie: t.Cookie({
					name: t.Optional(t.String())
				})
			},
			({ cookie: { name } }) => {
				if (!name.value) name.value = 'seminar: Himari'

				return name.value
			}
		)

		const response = await app.handle('/update', {
			headers: {
				cookie: `name=${await signCookie('seminar: Himari', secrets)}`
			}
		})

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
			{
				cookie: t.Cookie({
					name: t.Optional(t.String())
				})
			},
			({ cookie: { name } }) => {
				if (!name.value) name.value = 'seminar: Himari'

				return name.value
			}
		)

		const response = await app.handle('/update', {
			headers: {
				cookie: `name=${await signCookie('seminar: Himari', secrets)}`
			}
		})

		expect(response.status).toBe(200)
	})

	it('set cookie property from constructor', async () => {
		const app = new Elysia({
			cookie: {
				httpOnly: true,
				path: ''
			}
		}).get('/create', ({ cookie: { name } }) => (name.value = 'Himari'))

		const response = await app.handle('/create')

		expect(response.headers.getAll('Set-Cookie')).toEqual([
			'name=Himari; Path=/; HttpOnly'
		])
	})

	it('retain cookie value when using set if not provided', async () => {
		const response = await app.handle('/set')

		expect(response.headers.getAll('Set-Cookie')).toEqual([
			'session=rin; Path=/'
		])
	})

	it('parse object cookie', async () => {
		const app = new Elysia().get(
			'/council',
			{
				cookie: t.Cookie({
					council: t.Object({
						name: t.String(),
						affilation: t.String()
					})
				})
			},
			({ cookie: { council } }) => council.value
		)

		const expected = {
			name: 'Rin',
			affilation: 'Administration'
		}

		const response = await app.handle('/council', {
			headers: {
				cookie: 'council=' + JSON.stringify(expected)
			}
		})

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual(expected)
	})

	it('handle optional at root', async () => {
		const app = new Elysia().get(
			'/',
			{
				cookie: t.Optional(
					t.Object({
						id: t.Numeric()
					})
				)
			},
			({ cookie: { id } }) => id.value
		)

		const res = await Promise.all([
			app.handle('/').then((x) => x.text()),
			app
				.handle('/', {
					headers: {
						cookie: 'id=1'
					}
				})
				.then((x) => x.text())
		])

		expect(res).toEqual(['', '1'])
	})

	it("don't set cookie if new value is undefined", async () => {
		const app = new Elysia().get('/', ({ cookie: { id } }) => {
			id.value = undefined

			return 'a'
		})

		const res = app.handle('/').then((x) => x.headers.toJSON())

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

	it('memoizes Cookie instances per request jar', async () => {
		const app = new Elysia().get('/identity', ({ cookie }) => ({
			same: cookie.session === cookie.session,
			distinct: cookie.session !== cookie.other
		}))

		const response = await app.handle('/identity', {
			headers: {
				cookie: 'session=a'
			}
		})

		await expect(response.json()).resolves.toEqual({
			same: true,
			distinct: true
		})
	})

	it('emits an incoming cookie when only an attribute changes', async () => {
		const app = new Elysia().get('/attr', ({ cookie: { session } }) => {
			session.domain = 'elysiajs.com'

			return 'ok'
		})

		const response = await app.handle('/attr', {
			headers: {
				cookie: 'session=a'
			}
		})

		expect(getCookies(response)).toEqual([
			'session=a; Domain=elysiajs.com; Path=/'
		])
	})

	it('signs a cookie set before a thrown-then-handled error', async () => {
		const app = new Elysia()
			.error(() => 'handled')
			.get(
				'/boom',
				{
					cookie: t.Cookie(
						{ name: t.Optional(t.String()) },
						{ secrets, sign: ['name'] }
					)
				},
				({ cookie: { name } }) => {
					name.value = 'seminar: Himari'

					throw new Error('boom')
				}
			)

		const response = await app.handle('/boom')

		await expect(response.text()).resolves.toBe('handled')
		expect(getCookies(response)).toEqual([
			`name=${await signCookie('seminar: Himari', secrets, 'name')}; Path=/`
		])
	})

	// Returning a `Cookie` serves its value. The dispatch arm used to gate on a
	// public `jar` that does not exist (the jar is a private field), so it never
	// fired and the cookie fell through to `new Response(cookie)` — the value
	// arrived via `toString()` with no content-type. An object value must be
	// mapped as JSON like any other object response.
	it('serves a returned cookie value with the right content-type', async () => {
		const app = new Elysia()
			.get('/object', ({ cookie: { a } }) => {
				a.value = { x: 1 }

				return a
			})
			.get('/string', ({ cookie: { b } }) => {
				b.value = 'v'

				return b
			})

		const object = await app.handle('/object')
		expect(object.headers.get('content-type')).toStartWith(
			'application/json'
		)
		await expect(object.json()).resolves.toEqual({ x: 1 })

		// a string maps exactly as any other string response does
		const string = await app.handle('/string')
		await expect(string.text()).resolves.toBe('v')
	})

	it('does not treat a foreign class named Cookie as a real Cookie', async () => {
		class Cookie {
			name = 'Lilith'
		}

		class Kookie {
			name = 'Satre'
		}

		const app = new Elysia()
			.get('/fake-cookie', () => new Cookie())
			.get('/other-class', () => new Kookie())

		const fake = await app.handle('/fake-cookie')
		const other = await app.handle('/other-class')

		await expect(fake.text()).resolves.toBe('[object Object]')
		await expect(other.text()).resolves.toBe('[object Object]')
	})
})
