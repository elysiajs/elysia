import { Elysia, t } from '../src'

import { describe, expect, it } from 'bun:test'

const req = (path: string) => new Request(path)

describe('Path', () => {
	it('Handle root', async () => {
		const app = new Elysia().get('/', () => 'Hi')
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('Hi')
	})

	it('Handle multiple level', async () => {
		const app = new Elysia().get('/this/is/my/deep/nested/root', () => 'Ok')
		const res = await app.handle(
			req('http://localhost:8080/this/is/my/deep/nested/root')
		)

		expect(await res.text()).toBe('Ok')
	})

	it('Return boolean', async () => {
		const app = new Elysia().get('/', () => true)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('true')
	})

	it('Return number', async () => {
		const app = new Elysia().get('/', () => 617)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('617')
	})

	it('Return json', async () => {
		const app = new Elysia().get('/', () => ({
			name: 'takodachi'
		}))
		const res = await app.handle(req('/'))

		expect(JSON.stringify(await res.json())).toBe(
			JSON.stringify({
				name: 'takodachi'
			})
		)
		expect(res.headers.get('content-type')).toBe('application/json')
	})

	it('Return response', async () => {
		const app = new Elysia().get(
			'/',
			() =>
				new Response('Shuba Shuba', {
					headers: {
						duck: 'shuba duck'
					},
					status: 418
				})
		)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('Shuba Shuba')
		expect(res.status).toBe(418)
		expect(res.headers.get('duck')).toBe('shuba duck')
	})

	it('Parse single param', async () => {
		const app = new Elysia().get('/id/:id', ({ params: { id } }) => id)
		const res = await app.handle(req('/id/123'))

		expect(await res.text()).toBe('123')
	})

	it('Parse multiple params', async () => {
		const app = new Elysia().get(
			'/id/:id/:name',
			({ params: { id, name } }) => `${id}/${name}`,
			{
				schema: {
					params: t.Object({
						id: t.String(),
						name: t.String()
					})
				}
			}
		)
		const res = await app.handle(req('/id/fubuki/Elysia'))

		expect(await res.text()).toBe('fubuki/Elysia')
	})

	it('Accept wildcard', async () => {
		const app = new Elysia().get('/wildcard/*', () => 'Wildcard')

		const res = await app.handle(req('/wildcard/okayu'))

		expect(await res.text()).toBe('Wildcard')
	})

	// ? Blocking on https://github.com/oven-sh/bun/issues/1435
	// it('Custom error', async () => {
	// 	const app = new Elysia().onError((error) => {
	// 		if (error.code === 'NOT_FOUND')
	// 			return new Response('Not Stonk :(', {
	// 				status: 404
	// 			})
	// 	})

	// 	const res = await app.handle(req('/wildcard/okayu'))

	// 	expect(await res.text()).toBe('Not Stonk :(')
	// 	expect(res.status).toBe(404)
	// })

	it('Parse a querystring', async () => {
		const app = new Elysia().get('/', ({ query: { id } }) => id)
		const res = await app.handle(req('/?id=123'))

		expect(await res.text()).toBe('123')
	})

	it('Parse multiple querystrings', async () => {
		const app = new Elysia().get(
			'/',
			({ query: { first, last } }) => `${last} ${first}`,
			{
				schema: {
					query: t.Object({
						first: t.String(),
						last: t.String()
					})
				}
			}
		)
		const res = await app.handle(req('/?first=Fubuki&last=Shirakami'))

		expect(await res.text()).toBe('Shirakami Fubuki')
	})

	it('Handle body', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			schema: {
				body: t.String()
			}
		})

		const body = 'Botan'

		const res = await app.handle(
			new Request('/', {
				method: 'POST',
				body,
				headers: {
					'content-type': 'text/plain',
					'content-length': body.length.toString()
				}
			})
		)

		expect(await res.text()).toBe('Botan')
	})

	it('Parse JSON body', async () => {
		const body = JSON.stringify({
			name: 'Okayu'
		})

		const app = new Elysia().post('/', ({ body }) => body, {
			schema: {
				body: t.Object({
					name: t.String()
				})
			}
		})
		const res = await app.handle(
			new Request('/', {
				method: 'POST',
				body,
				headers: {
					'content-type': 'application/json',
					'content-length': body.length.toString()
				}
			})
		)

		expect(JSON.stringify(await res.json())).toBe(body)
	})

	it('Parse headers', async () => {
		const app = new Elysia().post('/', ({ request }) =>
			request.headers.get('x-powered-by')
		)
		const res = await app.handle(
			new Request('/', {
				method: 'POST',
				headers: {
					'x-powered-by': 'Elysia'
				}
			})
		)

		expect(await res.text()).toBe('Elysia')
	})

	it('Handle group', async () => {
		const app = new Elysia().group('/gamer', (app) => {
			app.get('/korone', () => 'Yubi Yubi!')
		})
		const res = await app.handle(req('/gamer/korone'))

		expect(await res.text()).toBe('Yubi Yubi!')
	})

	it('Handle plugin', async () => {
		const plugin = (app: Elysia) => app.get('/korone', () => 'Yubi Yubi!')
		const app = new Elysia().use(plugin)

		const res = await app.handle(req('/korone'))

		expect(await res.text()).toBe('Yubi Yubi!')
	})

	it('Handle error', async () => {
		const error = 'Pardun?'

		const plugin = (app: Elysia) =>
			app.get('/error', () => new Error(error))
		const app = new Elysia().use(plugin)

		const res = await app.handle(req('/error'))
		const { message } = (await res.json()) as unknown as {
			message: string
		}

		expect(message).toBe(error)
	})

	it('Handle async', async () => {
		const app = new Elysia().get('/async', async () => {
			await new Promise<void>((resolve) =>
				setTimeout(() => {
					resolve()
				}, 1)
			)

			return 'Hi'
		})

		const res = await app.handle(req('/async'))
		expect(await res.text()).toBe('Hi')
	})

	it('Handle absolute path', async () => {
		const app = new Elysia().get('/', () => 'Hi')
		const res = await app.handle(req('https://saltyaom.com/'))

		expect(await res.text()).toBe('Hi')
	})

	it('Handle route which start with same letter', async () => {
		const app = new Elysia()
			.get('/aa', () => 'route 1')
			.get('/ab', () => 'route 2')

		const response = await app.handle(new Request('/ab'))
		const text = await response.text()
		expect(text).toBe('route 2')
	})

	it('Handle route which start with same letter', async () => {
		const app = new Elysia()
			.get('/aa', () => 'route 1')
			.get('/ab', () => 'route 2')

		const response = await app.handle(new Request('/ab'))
		const text = await response.text()
		expect(text).toBe('route 2')
	})

	it('Return file', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers.server = 'Elysia'

			return Bun.file('./example/takodachi.png')
		})
		const res = await app.handle(req('/'))

		expect((await res.text()).length).toBe(
			(await Bun.file('./example/takodachi.png').text()).length
		)
		expect(res.headers.get('Server')).toBe('Elysia')
	})

	it('Handle non start /', async () => {
		const app = new Elysia().get('', () => 'Hi')
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('Hi')
	})

	it('Handle *', async () => {
		const app = new Elysia().get('*', () => 'Hi')
		const get = await app.handle(req('/')).then((r) => r.text())
		const post = await app
			.handle(req('/anything/should/match'))
			.then((r) => r.text())

		expect(get).toBe('Hi')
		expect(post).toBe('Hi')
	})

	it('Handle * on multiple methods', async () => {
		const app = new Elysia()
			.get('/part', () => 'Part')
			.options('*', () => 'Hi')

		const get = await app.handle(req('/part')).then((r) => r.text())
		const options = await app
			.handle(
				new Request('/part', {
					method: 'OPTIONS'
				})
			)
			.then((r) => r.text())

		expect(get).toBe('Part')
		expect(options).toBe('Hi')
	})
})
