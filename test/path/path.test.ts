import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

describe('Path', () => {
	it('handle root', async () => {
		const app = new Elysia().get('/', () => 'Hi')
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('Hi')
	})

	it('handle multiple level', async () => {
		const app = new Elysia().get('/this/is/my/deep/nested/root', () => 'Ok')
		const res = await app.handle(req('/this/is/my/deep/nested/root'))

		expect(await res.text()).toBe('Ok')
	})

	it('return boolean', async () => {
		const app = new Elysia().get('/', () => true)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('true')
	})

	it('return number', async () => {
		const app = new Elysia().get('/', () => 617)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('617')
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

		expect(await res.text()).toBe('Shuba Shuba')
		expect(res.status).toBe(418)
		expect(res.headers.get('duck')).toBe('shuba duck')
	})

	it('parse single param', async () => {
		const app = new Elysia().get('/id/:id', ({ params: { id } }) => id)
		const res = await app.handle(req('/id/123'))

		expect(await res.text()).toBe('123')
	})

	it('parse multiple params', async () => {
		const app = new Elysia().get(
			'/id/:id/:name',
			({ params: { id, name } }) => `${id}/${name}`
		)
		const res = await app.handle(req('/id/fubuki/Elysia'))

		expect(await res.text()).toBe('fubuki/Elysia')
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

		expect(await res.text()).toBe('Wildcard')
	})

	it('custom error', async () => {
		const app = new Elysia().onError((error) => {
			if (error.code === 'NOT_FOUND')
				return new Response('Not Stonk :(', {
					status: 404
				})
		})

		const res = await app.handle(req('/wildcard/okayu'))

		expect(await res.text()).toBe('Not Stonk :(')
		expect(res.status).toBe(404)
	})

	it('parse a querystring', async () => {
		const app = new Elysia().get('/', ({ query: { id } }) => id)
		const res = await app.handle(req('/?id=123'))

		expect(await res.text()).toBe('123')
	})

	it('parse multiple querystrings', async () => {
		const app = new Elysia().get(
			'/',
			({ query: { first, last } }) => `${last} ${first}`,
			{
				query: t.Object({
					first: t.String(),
					last: t.String()
				})
			}
		)
		const res = await app.handle(req('/?first=Fubuki&last=Shirakami'))

		expect(await res.text()).toBe('Shirakami Fubuki')
	})

	it('parse a querystring with a space', async () => {
		const app = new Elysia().get('/', ({ query: { id } }) => id)
		const res = await app.handle(req('/?id=test+123%2B'))

		expect(await res.text()).toBe('test 123+')
	})

	it('handle body', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.String()
		})

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

		expect(await res.text()).toBe('Botan')
	})

	it('parse JSON body', async () => {
		const body = JSON.stringify({
			name: 'Okayu'
		})

		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				name: t.String()
			})
		})
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

		expect(await res.text()).toBe('Elysia')
	})

	it('handle group', async () => {
		const app = new Elysia().group('/gamer', (app) =>
			app.get('/korone', () => 'Yubi Yubi!')
		)

		const res = await app.handle(req('/gamer/korone')).then((r) => r.text())

		expect(await res).toBe('Yubi Yubi!')
	})

	it('handle plugin', async () => {
		const plugin = (app: Elysia) => app.get('/korone', () => 'Yubi Yubi!')
		const app = new Elysia().use(plugin)

		const res = await app.handle(req('/korone'))

		expect(await res.text()).toBe('Yubi Yubi!')
	})

	it('handle error', async () => {
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
		expect(await res.text()).toBe('Hi')
	})

	it('handle absolute path', async () => {
		const app = new Elysia().get('/', () => 'Hi')
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('Hi')
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

	it('return web api\'s File', async () => {
		const app = new Elysia().get('/', () => new File(['Hello'], 'hello.txt', { type: 'text/plain' }))
		const res = await app.handle(req('/'))

		expect(res.headers.get('content-type')).toBe('text/plain;charset=utf-8')
		expect(await res.text()).toBe('Hello')
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
			.onRequest(() => {})
			.onAfterHandle(({ path }) => {
				return path
			})
			.get('/', () => 'Hi')

		const res = await app.handle(req('/')).then((res) => res.text())

		expect(res).toBe('/')
	})

	// it('handle array route - GET', async () => {
	// 	const paths = ['/', '/test', '/other/nested']
	// 	const app = new Elysia().get(paths, ({ path }) => {
	// 		return path
	// 	})

	// 	for (const path of paths) {
	// 		const res = await app.handle(req(path))
	// 		expect(await res.text()).toBe(path)
	// 	}
	// })

	// it('handle array route - POST', async () => {
	// 	const paths = ['/', '/test', '/other/nested']
	// 	const app = new Elysia().post(paths, ({ path }) => {
	// 		return path
	// 	})

	// 	for (const path of paths) {
	// 		const res = await app.handle(
	// 			new Request('http://localhost' + path, {
	// 				method: 'POST'
	// 			})
	// 		)
	// 		expect(await res.text()).toBe(path)
	// 	}
	// })

	// it('handle array route - PUT', async () => {
	// 	const paths = ['/', '/test', '/other/nested']
	// 	const app = new Elysia().put(paths, ({ path }) => {
	// 		return path
	// 	})

	// 	for (const path of paths) {
	// 		const res = await app.handle(
	// 			new Request('http://localhost' + path, {
	// 				method: 'PUT'
	// 			})
	// 		)
	// 		expect(await res.text()).toBe(path)
	// 	}
	// })

	// it('handle array route - DELETE', async () => {
	// 	const paths = ['/', '/test', '/other/nested']
	// 	const app = new Elysia().delete(paths, ({ path }) => {
	// 		return path
	// 	})

	// 	for (const path of paths) {
	// 		const res = await app.handle(
	// 			new Request('http://localhost' + path, {
	// 				method: 'DELETE'
	// 			})
	// 		)
	// 		expect(await res.text()).toBe(path)
	// 	}
	// })

	// it('handle array route - PATCH', async () => {
	// 	const paths = ['/', '/test', '/other/nested']
	// 	const app = new Elysia().patch(paths, ({ path }) => {
	// 		return path
	// 	})

	// 	for (const path of paths) {
	// 		const res = await app.handle(
	// 			new Request('http://localhost' + path, {
	// 				method: 'PATCH'
	// 			})
	// 		)
	// 		expect(await res.text()).toBe(path)
	// 	}
	// })

	// it('handle array route - HEAD', async () => {
	// 	const paths = ['/', '/test', '/other/nested']
	// 	const app = new Elysia().head(paths, ({ path }) => {
	// 		return path
	// 	})

	// 	for (const path of paths) {
	// 		const res = await app.handle(
	// 			new Request('http://localhost' + path, {
	// 				method: 'HEAD'
	// 			})
	// 		)
	// 		expect(await res.text()).toBe(path)
	// 	}
	// })

	// it('handle array route - OPTIONS', async () => {
	// 	const paths = ['/', '/test', '/other/nested']
	// 	const app = new Elysia().options(paths, ({ path }) => {
	// 		return path
	// 	})

	// 	for (const path of paths) {
	// 		const res = await app.handle(
	// 			new Request('http://localhost' + path, {
	// 				method: 'OPTIONS'
	// 			})
	// 		)
	// 		expect(await res.text()).toBe(path)
	// 	}
	// })

	// it('handle array route - CONNECT', async () => {
	// 	const paths = ['/', '/test', '/other/nested']
	// 	const app = new Elysia().connect(paths, ({ path }) => {
	// 		return path
	// 	})

	// 	for (const path of paths) {
	// 		const res = await app.handle(
	// 			new Request('http://localhost' + path, {
	// 				method: 'CONNECT'
	// 			})
	// 		)
	// 		expect(await res.text()).toBe(path)
	// 	}
	// })

	// it('handle array route - all', async () => {
	// 	const paths = ['/', '/test', '/other/nested'] as const
	// 	const app = new Elysia().all(paths, ({ path }) => {
	// 		return path
	// 	})

	// 	for (const path of paths) {
	// 		const getRes = await app.handle(req(path))
	// 		const postRes = await app.handle(
	// 			new Request('http://localhost' + path, {
	// 				method: 'POST'
	// 			})
	// 		)
	// 		const putRes = await app.handle(
	// 			new Request('http://localhost' + path, {
	// 				method: 'PUT'
	// 			})
	// 		)
	// 		const deleteRes = await app.handle(
	// 			new Request('http://localhost' + path, {
	// 				method: 'DELETE'
	// 			})
	// 		)
	// 		const patchRes = await app.handle(
	// 			new Request('http://localhost' + path, {
	// 				method: 'PATCH'
	// 			})
	// 		)
	// 		const headRes = await app.handle(
	// 			new Request('http://localhost' + path, {
	// 				method: 'HEAD'
	// 			})
	// 		)

	// 		expect(await getRes.text()).toBe(path)
	// 		expect(await postRes.text()).toBe(path)
	// 		expect(await putRes.text()).toBe(path)
	// 		expect(await deleteRes.text()).toBe(path)
	// 		expect(await patchRes.text()).toBe(path)
	// 		expect(await headRes.text()).toBe(path)
	// 	}
	// })

	// it('handle array route - custom method', async () => {
	// 	const paths = ['/', '/test', '/other/nested'] as const
	// 	// @ts-ignore
	// 	const app = new Elysia().route('NOTIFY', paths, ({ path }) => {
	// 		return path
	// 	})

	// 	for (const path of paths) {
	// 		const res = await app.handle(
	// 			new Request('http://localhost' + path, {
	// 				method: 'NOTIFY'
	// 			})
	// 		)
	// 		expect(await res.text()).toBe(path)
	// 	}
	// })
})
