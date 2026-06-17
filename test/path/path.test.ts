import { Elysia, NotFound, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

describe('Path', () => {
	it('handle root', async () => {
		const app = new Elysia().get('/', () => 'Hi')
		const res = await app.handle(req('/'))

		await expect(res.text()).resolves.toBe('Hi')
	})

	it('handle multiple level', async () => {
		const app = new Elysia().get('/this/is/my/deep/nested/root', () => 'Ok')
		const res = await app.handle(req('/this/is/my/deep/nested/root'))

		await expect(res.text()).resolves.toBe('Ok')
	})

	it('return boolean', async () => {
		const app = new Elysia().get('/', () => true)
		const res = await app.handle(req('/'))

		await expect(res.text()).resolves.toBe('true')
	})

	it('return number', async () => {
		const app = new Elysia().get('/', () => 617)
		const res = await app.handle(req('/'))

		await expect(res.text()).resolves.toBe('617')
	})

	it('return json', async () => {
		const app = new Elysia().get('/', () => ({
			name: 'takodachi'
		}))
		const res = await app.handle(req('/'))

		expect(JSON.stringify(await res.json())).toBe(
			JSON.stringify({
				name: 'takodachi'
			})
		)
		expect(res.headers.get('content-type')).toContain('application/json')
	})

	it('return response', async () => {
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

		await expect(res.text()).resolves.toBe('Shuba Shuba')
		expect(res.status).toBe(418)
		expect(res.headers.get('duck')).toBe('shuba duck')
	})

	it('parse single param', async () => {
		const app = new Elysia().get('/id/:id', ({ params: { id } }) => id)
		const res = await app.handle(req('/id/123'))

		await expect(res.text()).resolves.toBe('123')
	})

	it('parse multiple params', async () => {
		const app = new Elysia().get(
			'/id/:id/:name',
			({ params: { id, name } }) => `${id}/${name}`
		)
		const res = await app.handle(req('/id/fubuki/Elysia'))

		await expect(res.text()).resolves.toBe('fubuki/Elysia')
	})

	it('parse optional params', async () => {
		const app = new Elysia().get('/id/:id?', ({ params: { id } }) => id)

		const res = await Promise.all([
			app.handle(req('/id')).then((x) => x.text()),
			app.handle(req('/id/fubuki')).then((x) => x.text())
		])

		expect(res).toEqual(['', 'fubuki'])
	})

	it('parse multiple optional params', async () => {
		const app = new Elysia().get(
			'/id/:id?/:name?',
			({ params: { id = '', name = '' } }) => `${id}/${name}`
		)

		const res = await Promise.all([
			app.handle(req('/id')).then((x) => x.text()),
			app.handle(req('/id/fubuki')).then((x) => x.text()),
			app.handle(req('/id/fubuki/shirakami')).then((x) => x.text())
		])

		expect(res).toEqual(['/', 'fubuki/', 'fubuki/shirakami'])
	})

	it('accept wildcard', async () => {
		const app = new Elysia().get('/wildcard/*', () => 'Wildcard')

		const res = await app.handle(req('/wildcard/okayu'))

		await expect(res.text()).resolves.toBe('Wildcard')
	})

	it('custom error', async () => {
		const app = new Elysia().error(({ error }) => {
			if (error instanceof NotFound)
				return new Response('Not Stonk :(', {
					status: 404
				})
		})

		const res = await app.handle(req('/wildcard/okayu'))

		await expect(res.text()).resolves.toBe('Not Stonk :(')
		expect(res.status).toBe(404)
	})

	it('parse a querystring', async () => {
		const app = new Elysia().get('/', ({ query: { id } }) => id)
		const res = await app.handle(req('/?id=123'))

		await expect(res.text()).resolves.toBe('123')
	})

	it('parse multiple querystrings', async () => {
		const app = new Elysia().get(
			'/',
			{
				query: t.Object({
					first: t.String(),
					last: t.String()
				})
			},
			({ query: { first, last } }) => `${last} ${first}`
		)
		const res = await app.handle(req('/?first=Fubuki&last=Shirakami'))

		await expect(res.text()).resolves.toBe('Shirakami Fubuki')
	})

	it('parse a querystring with a space', async () => {
		const app = new Elysia().get('/', ({ query: { id } }) => id)
		const res = await app.handle(req('/?id=test+123%2B'))

		await expect(res.text()).resolves.toBe('test 123+')
	})

	it('handle body', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.String()
			},
			({ body }) => body
		)

		const body = 'Botan'

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				body,
				headers: {
					'content-type': 'text/plain',
					'content-length': body.length.toString()
				}
			})
		)

		await expect(res.text()).resolves.toBe('Botan')
	})

	it('parse JSON body', async () => {
		const body = JSON.stringify({
			name: 'Okayu'
		})

		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					name: t.String()
				})
			},
			({ body }) => body
		)
		const res = await app.handle(
			new Request('http://localhost/', {
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

	it('parse headers', async () => {
		const app = new Elysia().post('/', ({ request }) =>
			request.headers.get('x-powered-by')
		)
		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: {
					'x-powered-by': 'Elysia'
				}
			})
		)

		await expect(res.text()).resolves.toBe('Elysia')
	})

	it('handle group', async () => {
		const app = new Elysia().group('/gamer', (app) =>
			app.get('/korone', () => 'Yubi Yubi!')
		)

		const res = await app.handle(req('/gamer/korone')).then((r) => r.text())

		expect(res).toBe('Yubi Yubi!')
	})

	it('handle plugin', async () => {
		const plugin = (app: Elysia) => app.get('/korone', () => 'Yubi Yubi!')
		const app = new Elysia().use(plugin)

		const res = await app.handle(req('/korone'))

		await expect(res.text()).resolves.toBe('Yubi Yubi!')
	})

	it('handle error', async () => {
		const error = 'Pardun?'

		const plugin = (app: Elysia) =>
			app.get('/error', () => new Error(error))
		const app = new Elysia().use(plugin)

		const res = await app.handle(req('/error'))

		expect(res.status).toBe(500)
		await expect(res.text()).resolves.toBe(error)
	})

	it('handle async', async () => {
		const app = new Elysia().get('/async', async () => {
			await new Promise<void>((resolve) =>
				setTimeout(() => {
					resolve()
				}, 1)
			)

			return 'Hi'
		})

		const res = await app.handle(req('/async'))
		await expect(res.text()).resolves.toBe('Hi')
	})

	it('handle absolute path', async () => {
		const app = new Elysia().get('/', () => 'Hi')
		const res = await app.handle(req('/'))

		await expect(res.text()).resolves.toBe('Hi')
	})

	it('handle route which start with same letter', async () => {
		const app = new Elysia()
			.get('/aa', () => 'route 1')
			.get('/ab', () => 'route 2')

		const response = await app.handle(req('/ab'))
		const text = await response.text()
		expect(text).toBe('route 2')
	})

	it('handle route which start with same letter', async () => {
		const app = new Elysia()
			.get('/aa', () => 'route 1')
			.get('/ab', () => 'route 2')

		const response = await app.handle(req('/ab'))
		const text = await response.text()
		expect(text).toBe('route 2')
	})

	it('return file', async () => {
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

	it("return web api's File", async () => {
		const app = new Elysia().get(
			'/',
			() => new File(['Hello'], 'hello.txt', { type: 'text/plain' })
		)
		const res = await app.handle(req('/'))

		expect(res.headers.get('content-type')).toBe('text/plain;charset=utf-8')
		await expect(res.text()).resolves.toBe('Hello')
		expect(res.status).toBe(200)
		expect(res.headers.get('accept-ranges')).toBe('bytes')
		expect(res.headers.get('content-range')).toBe('bytes 0-4/5')
	})

	it('handle *', async () => {
		const app = new Elysia().get('/*', () => 'Hi')
		const get = await app.handle(req('/')).then((r) => r.text())
		const post = await app
			.handle(req('/anything/should/match'))
			.then((r) => r.text())

		expect(get).toBe('Hi')
		expect(post).toBe('Hi')
	})

	it('handle * on multiple methods', async () => {
		const app = new Elysia()
			.get('/part', () => 'Part')
			.options('*', () => 'Hi')

		const get = await app.handle(req('/part')).then((r) => r.text())
		const options = await app
			.handle(
				new Request('http://localhost/part', {
					method: 'OPTIONS'
				})
			)
			.then((r) => r.text())

		expect(get).toBe('Part')
		expect(options).toBe('Hi')
	})

	it('decode uri', async () => {
		const app = new Elysia().get('/', ({ query }) => query)

		const res = await app
			.handle(req('/?name=a%20b&c=d%20e'))
			.then((r) => r.json())

		expect(res).toEqual({
			name: 'a b',
			c: 'd e'
		})
	})

	it('handle all method', async () => {
		const app = new Elysia().all('/', () => 'Hi')
		const res1 = await app.handle(req('/')).then((res) => res.text())
		const res2 = await app.handle(post('/', {})).then((res) => res.text())

		expect(res1).toBe('Hi')
		expect(res2).toBe('Hi')
	})

	it('add path if onRequest is used', async () => {
		const app = new Elysia()
			.request(() => {})
			.afterHandle(({ path }) => {
				return path
			})
			.get('/', () => 'Hi')

		const res = await app.handle(req('/')).then((res) => res.text())

		expect(res).toBe('/')
	})

	it('does not grow the route map on distinct request paths', async () => {
		const app = new Elysia().get('/foo', () => 'hi')
		await app.handle(req('/foo'))

		const map = (app as any)['~map'].GET as Record<string, unknown>
		const before = Object.keys(map).length

		for (let i = 0; i < 1000; i++) await app.handle(req(`/missing/${i}`))
		// over-encoded / garbage variants must not be cached either
		for (let i = 0; i < 200; i++) await app.handle(req(`/%66oo${i}`))

		expect(Object.keys(map).length).toBe(before)

		// exact route still resolves
		await expect(
			app.handle(req('/foo')).then((r) => r.text())
		).resolves.toBe('hi')
	})

	// The decode path was moved to build time (encodeURI stored alongside
	// ~map). A non-ASCII route must match both its literal form and its
	// canonical percent-encoded form (the usual on-the-wire shape), without a
	// per-request decode or any map growth.
	it('matches a non-ASCII route by its encoded and literal form', async () => {
		const app = new Elysia().get('/menu/café', () => 'coffee')
		await app.handle(req('/menu/café'))

		const map = (app as any)['~map'].GET as Record<string, unknown>
		const keys = Object.keys(map).length

		await expect(
			app.handle(req('/menu/café')).then((r) => r.text())
		).resolves.toBe('coffee')
		await expect(
			app.handle(req('/menu/caf%C3%A9')).then((r) => r.text())
		).resolves.toBe('coffee')
		// trailing slash on the encoded form (loose) still matches
		await expect(
			app.handle(req('/menu/caf%C3%A9/')).then((r) => r.text())
		).resolves.toBe('coffee')

		// the encoded key is precomputed at build time, not added per request
		expect(Object.keys(map).length).toBe(keys)
	})

	// A static route's trailing-slash (loose) variant is pre-registered in
	// `~map` at build time, so the fetch hot path resolves a trailing-slash
	// request by a direct lookup — there is no per-request getLoosePath.
	it('static route matches a trailing slash via a pre-registered loose key', async () => {
		const app = new Elysia().get('/x', () => 'x')
		app.compile()

		const map = (app as any)['~map'].GET as Record<string, unknown>
		expect('/x' in map).toBe(true)
		expect('/x/' in map).toBe(true)

		await expect(app.handle(req('/x')).then((r) => r.text())).resolves.toBe(
			'x'
		)
		await expect(
			app.handle(req('/x/')).then((r) => r.text())
		).resolves.toBe('x')
	})

	it('strictPath does not pre-register a static loose variant', async () => {
		const app = new Elysia({ strictPath: true }).get('/x', () => 'x')
		app.compile()

		const map = (app as any)['~map'].GET as Record<string, unknown>
		expect('/x/' in map).toBe(false)
		await expect(
			app.handle(req('/x/')).then((r) => r.status)
		).resolves.toBe(404)
	})

	// Regression (audit H10): dynamic (parameterized) routes were registered
	// only at the exact path, so `/users/1/` 404'd on `/users/:id` even though
	// static routes tolerate trailing slashes by default. Register the loose
	// variant unless strictPath.
	it('dynamic route matches a trailing slash when not strict', async () => {
		const app = new Elysia().get(
			'/users/:id',
			({ params: { id } }) => `user:${id}`
		)

		await expect(
			app.handle(req('/users/1')).then((r) => r.text())
		).resolves.toBe('user:1')
		// before the fix this 404'd
		await expect(
			app.handle(req('/users/1/')).then((r) => r.text())
		).resolves.toBe('user:1')
	})

	it('strictPath still rejects a trailing slash on dynamic routes', async () => {
		const app = new Elysia({ strictPath: true }).get(
			'/users/:id',
			({ params: { id } }) => `user:${id}`
		)

		await expect(
			app.handle(req('/users/1/')).then((r) => r.status)
		).resolves.toBe(404)
	})
})
