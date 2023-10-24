import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'
import { req } from '../utils'
import { signCookie } from '../../src/utils'

const secrets = 'We long for the seven wailings. We bear the koan of Jericho.'

const getCookies = (response: Response) =>
	response.headers.getAll('Set-Cookie').map((x) => {
		const value = decodeURIComponent(x)

		return value
	})

const app = new Elysia({
	cookie: {
		path: ''
	}
})
	.get(
		'/council',
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
		for (const self of Object.values(cookie)) self.remove({ path: "/", domain: "elysiajs.com", sameSite: "lax", secure: true})

		return 'Deleted'
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

	it('skip duplicate cookie value', async () => {
		const response = await app.handle(
			req('/council', {
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

		expect(getCookies(response)).toEqual([])
	})

	it('write cookie on difference value', async () => {
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
			'council=[{"name":"Rin","affilation":"Administration"}]'
		])
	})

	it('remove cookie without options', async () => {
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

		expect(getCookies(response)[0]).toInclude(`council=; Max-Age=0; Expires=${new Date(0).toUTCString()}`)
	})

	it('remove cookie with options', async () => {
		const response = await app.handle(
			req('/remove-with-options', {
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

		expect(getCookies(response)[0]).toInclude(`council=; Max-Age=0; Domain=elysiajs.com; Path=/; Expires=${new Date(0).toUTCString()}; Secure; SameSite=Lax`)
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
})
