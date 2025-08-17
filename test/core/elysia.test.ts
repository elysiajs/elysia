import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Edge Case', () => {
	it('handle state', async () => {
		const app = new Elysia()
			.state('a', 'a')
			.get('/', ({ store: { a } }) => a)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('a')
	})

	// https://github.com/oven-sh/bun/issues/1523
	it("don't return HTTP 10", async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers.Server = 'Elysia'

			return 'hi'
		})

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
	})

	it('has no side-effect', async () => {
		const app = new Elysia()
			.get('/1', ({ set }) => {
				set.headers['x-server'] = 'Elysia'

				return 'hi'
			})
			.get('/2', () => 'hi')

		const res1 = await app.handle(req('/1'))
		const res2 = await app.handle(req('/2'))

		expect(res1.headers.get('x-server')).toBe('Elysia')
		expect(res2.headers.get('x-server')).toBe(null)
	})

	it('return Promise', async () => {
		const app = new Elysia().get(
			'/',
			() => new Promise((resolve) => resolve('h'))
		)

		const res = await app.handle(req('/')).then((x) => x.text())
		expect(res).toBe('h')
	})

	it('handle dynamic all method', async () => {
		const app = new Elysia().all('/all/*', () => 'ALL')

		const res = await app.handle(req('/all/world')).then((x) => x.text())
		expect(res).toBe('ALL')
	})

	// ? since different runtime expected to have different implementation of new Response
	// ? we can't handle all the case
	// it('handle object of class', async () => {
	// 	class SomeResponse {
	// 		constructor(public message: string) {}
	// 	}

	// 	const app = new Elysia().get(
	// 		'/',
	// 		() => new SomeResponse('Hello, world!')
	// 	)

	// 	const res = await app.handle(req('/')).then((x) => x.json())
	// 	expect(res).toStrictEqual({
	// 		message: 'Hello, world!'
	// 	})
	// })

	// it('handle object of class (async)', async () => {
	// 	class SomeResponse {
	// 		constructor(public message: string) {}
	// 	}

	// 	const app = new Elysia().get('/', async () => {
	// 		await Bun.sleep(1)
	// 		return new SomeResponse('Hello, world!')
	// 	})

	// 	const res = await app.handle(req('/')).then((x) => x.json())
	// 	expect(res).toStrictEqual({
	// 		message: 'Hello, world!'
	// 	})
	// })

	it('handle strict path and loose path', async () => {
		const loose = new Elysia().group('/a', (app) =>
			app.get('/', () => 'Hi')
		)

		expect(await loose.handle(req('/a')).then((x) => x.status)).toBe(200)
		expect(await loose.handle(req('/a/')).then((x) => x.status)).toBe(200)

		const strict = new Elysia({
			strictPath: true
		}).group('/a', (app) => app.get('/', () => 'Hi'))

		expect(await strict.handle(req('/a')).then((x) => x.status)).toBe(404)
		expect(await strict.handle(req('/a/')).then((x) => x.status)).toBe(200)
	})

	it('return cookie with file', async () => {
		const kyuukararin = Bun.file('test/kyuukurarin.mp4')

		const app = new Elysia().get('/', ({ cookie: { name } }) => {
			name.set({
				value: 'Rikuhachima Aru',
				maxAge: new Date().setFullYear(new Date().getFullYear() + 1),
				httpOnly: true
			})

			return kyuukararin
		})

		const response = await app
			.handle(req('/'))
			// @ts-expect-error
			.then((x) => x.headers.toJSON())

		expect(response['set-cookie']).toHaveLength(1)
		expect(response['content-type']).toBe('video/mp4')
	})

	it('return multiple cookies with file', async () => {
		const kyuukararin = Bun.file('test/kyuukurarin.mp4')

		const app = new Elysia().get('/', ({ cookie: { name, school } }) => {
			name.value = 'Rikuhachima Aru'
			school.value = 'Gehenna'

			return kyuukararin
		})

		const response = await app.handle(req('/'))

		expect(response.headers.get('content-type')).toBe('video/mp4')
		expect(response.headers.getSetCookie()).toEqual([
			'name=Rikuhachima%20Aru; Path=/',
			'school=Gehenna; Path=/'
		])
	})

	it('preserve correct index order of routes if duplicated', () => {
		const app = new Elysia()
			.get('/0', () => '0')
			.get('/1', () => '1')
			.get('/2', () => '2')
			.get('/3', () => '3')
			.get('/1', () => '-')
			.get('/4', () => '4')

		// @ts-expect-error
		expect(app.routeTree['GET_/0']).toEqual(0)
		// @ts-expect-error
		expect(app.routeTree['GET_/4']).toEqual(4)
	})

	it('preserve correct index order of routes if duplicated from plugin', () => {
		const plugin = new Elysia()
			.get('/3', () => '3')
			.get('/1', () => '-')
			.get('/4', () => '4')

		const app = new Elysia()
			.get('/0', () => '0')
			.get('/1', () => '1')
			.get('/2', () => '2')
			.use(plugin)

		// @ts-expect-error
		expect(app.routeTree['GET_/0']).toEqual(0)
		// @ts-expect-error
		expect(app.routeTree['GET_/4']).toEqual(4)
	})

	it('get getGlobalRoutes', () => {
		const plugin = new Elysia().get('/', () => 'hello')

		const main = new Elysia().use(plugin).get('/2', () => 'hi')

		// @ts-expect-error private property
		expect(main.getGlobalRoutes().length).toBe(2)
	})

	describe('value returned from transform has priority over the default value from schema', () => {
		const route = new Elysia().get(
			'/:propParams?',
			({ params: { propParams } }) => propParams,
			{
				params: t.Object({
					propParams: t.String({
						default: 'params-default'
					})
				}),
				transform({ params }) {
					params.propParams = 'params-transform'
				}
			}
		)

		it('aot is on', async () => {
			const app = new Elysia().use(route)

			const response = await app
				.handle(new Request('http://localhost'))
				.then((x) => x.text())

			expect(response).toBe('params-transform')
		})

		it('aot is off', async () => {
			const app = new Elysia({ aot: false }).use(route)

			const response = await app
				.handle(new Request('http://localhost'))
				.then((x) => x.text())

			expect(response).toBe('params-transform')
		})
	})

	it('handle duplicated static route may cause index conflict correctly', async () => {
		const Path = new Elysia({ name: 'auth' })
			.mount('/AB', (request) => new Response('AB'))
			.mount('/BA', (request) => new Response('BA'))

		const Module = new Elysia().use(Path)

		const app = new Elysia({ name: 'main' }).use(Path).use(Module)

		const responses = await Promise.all([
			app.handle(req('/AB')).then((x) => x.text()),
			app.handle(req('/BA')).then((x) => x.text())
		])

		expect(responses).toEqual(['AB', 'BA'])
	})

	it('handle complex union with json accelerate, exact mirror, and sanitize', async () => {
		const app = new Elysia({
			sanitize: (v) => v && 'Elysia'
		}).get(
			'/',
			() => ({
				type: 'ok',
				data: [
					{
						type: 'cool',
						data: null
					},
					{
						type: 'yea',
						data: {
							type: 'aight',
							data: null
						}
					}
				]
			}),
			{
				response: t.Recursive((This) =>
					t.Object({
						type: t.String(),
						data: t.Union([t.Nullable(This), t.Array(This)])
					})
				)
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			type: 'Elysia',
			data: [
				{
					type: 'Elysia',
					data: null
				},
				{
					type: 'Elysia',
					data: {
						type: 'Elysia',
						data: null
					}
				}
			]
		})
	})

	it('clone hooks before mapping it to usable function while compose', async () => {
		const group = new Elysia()
			.macro({
				user: (enabled: true) => ({
					resolve() {
						if (!enabled) return

						return {
							user: 'a'
						}
					}
				})
			})
			.get(
				'/',
				({ user, status }) => {
					if (!user) return status(401)

					return { hello: 'hanabi' }
				},
				{
					user: true
				}
			)

		const app = new Elysia({
			precompile: true
		}).group('/group', (app) => app.use(group))

		const response = await app.handle(req('/group')).then((x) => x.json())

		expect(response).toEqual({
			hello: 'hanabi'
		})
	})

	it('decode URI of path parameter', async () => {
		const api = new Elysia().get('/:id', ({ params }) => params, {
			params: t.Object({
				id: t.String()
			})
		})

		const value = await api
			.handle(new Request('http://localhost:3000/hello world'))
			.then((response) => response.json())

		expect(value).toEqual({
			id: 'hello world'
		})
	})

	it('clean non-root additionalProperties', async () => {
		const app = new Elysia().get(
			'/',
			() => ({
				keys: [{ a: 1, b: 2 }],
				extra: true
			}),
			{
				response: t.Object(
					{ keys: t.Array(t.Object({ a: t.Number() })) },
					{ additionalProperties: true }
				)
			}
		)

		const value = await app.handle(req('/')).then((x) => x.json())

		expect(value).toEqual({
			keys: [{ a: 1 }],
			extra: true
		})
	})

	it('prevent side-effect from guard merge', async () => {
		const app = new Elysia().guard(
			{
				response: {
					403: t.String()
				}
			},
			(app) =>
				app
					.get('/foo', () => 'bar', { response: { 200: t.String() } })
					.get('/bar', () => 12, { response: { 200: t.Integer() } })
		)

		const response = await app.handle(req('/foo'))

		expect(response.status).toBe(200)
	})
})
