import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'
import { req } from '../utils'
import { signCookie } from '../../src/utils'

const secrets = 'We long for the seven wailings. We bear the koan of Jericho.'

const getCookies = (response: Response) =>
	// @ts-expect-error
	response.headers.getAll('Set-Cookie').map((x) => {
		return decodeURIComponent(x)
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

describe('Dynamic Cookie Response', () => {
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
						) +
						'; Path=/'
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
					cookie: `name=${await signCookie('seminar: Himari', secrets)}`
				}
			})
		)

		expect(response.status).toBe(200)
	})

	it("don't share context between race condition", async () => {
		const resolver = Promise.withResolvers()

		const app = new Elysia({ aot: false })
			.onRequest(() => new Promise((resolve) => setTimeout(resolve, 1)))
			.get('/test', ({ request }) => {
				resolver.resolve(request.url)
			})

		app.handle(new Request('http://localhost:1025/test'))
		app.handle(new Request('http://localhost:1025/bad'))

		expect(await resolver.promise).toBe('http://localhost:1025/test')
	})
})
