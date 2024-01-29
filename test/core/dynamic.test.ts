import { Elysia, ElysiaConfig, NotFoundError, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

describe('Dynamic Mode', () => {
	it('handle path', async () => {
		const app = new Elysia({
			aot: false
		}).get('/', () => 'Hi')

		const res = await app.handle(req('/')).then((x) => x.text())
		expect(res).toBe('Hi')
	})

	it('handle body', async () => {
		const app = new Elysia({
			aot: false
		}).post('/', ({ body }) => body, {
			body: t.Object({
				name: t.String()
			})
		})

		const body = {
			name: 'saltyaom'
		} as const

		const res = (await app
			.handle(post('/', body))
			.then((x) => x.json())) as typeof body

		const invalid = await app.handle(post('/', {})).then((x) => x.status)

		expect(res.name).toBe(body.name)
		expect(invalid).toBe(400)
	})

	it('handle dynamic all method', async () => {
		const app = new Elysia({
			aot: false
		}).all('/all/*', () => 'ALL')

		const res = await app.handle(req('/all/world')).then((x) => x.text())
		expect(res).toBe('ALL')
	})

	it('inherits plugin', async () => {
		const plugin = () => (app: Elysia) => app.decorate('hi', () => 'hi')

		const app = new Elysia({
			aot: false
		})
			.use(plugin())
			.get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('hi')
	})

	it('use custom error', async () => {
		const res = await new Elysia({
			aot: false
		})
			.get('/', () => 'Hi')
			.onError(({ code }) => {
				if (code === 'NOT_FOUND')
					return new Response("I'm a teapot", {
						status: 418
					})
			})
			.handle(req('/not-found'))

		expect(await res.text()).toBe("I'm a teapot")
		expect(res.status).toBe(418)
	})

	it('inject headers to error', async () => {
		const app = new Elysia({
			aot: false
		})
			.onRequest(({ set }) => {
				set.headers['Access-Control-Allow-Origin'] = '*'
			})
			.get('/', () => {
				throw new NotFoundError()
			})

		const res = await app.handle(req('/'))

		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
		expect(res.status).toBe(404)
	})

	it('transform any to error', async () => {
		const app = new Elysia({
			aot: false
		})
			.get('/', () => {
				throw new NotFoundError()
			})
			.onError(async ({ set }) => {
				set.status = 418

				return 'aw man'
			})

		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('aw man')
		expect(res.status).toBe(418)
	})

	it('derive', async () => {
		const app = new Elysia({
			aot: false
		})
			.derive(() => {
				return {
					A: 'A'
				}
			})
			.get('/', ({ A }) => A)

		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('A')
		expect(res.status).toBe(200)
	})

	it('validate', async () => {
		const app = new Elysia({
			// aot: false
		}).post('/', ({ query: { id } }) => id.toString(), {
			body: t.Object({
				username: t.String(),
				password: t.String()
			}),
			query: t.Object({
				id: t.String()
			}),
			response: {
				200: t.String()
			}
		})

		const res = await app
			.handle(
				post('/?id=me', {
					username: 'username',
					password: 'password'
				})
			)
			.then((x) => x.text())
		expect(res).toBe('me')
	})

	it('handle non query fallback', async () => {
		const app = new Elysia({ aot: false }).get('/', () => 'hi', {
			query: t.Object({
				redirect_uri: t.Optional(t.String())
			})
		})

		const res1 = await app.handle(req('/'))
		const res2 = await app.handle(req('/?'))
		const res3 = await app.handle(req('/?redirect_uri=a'))

		expect(res1.status).toBe(200)
		expect(res2.status).toBe(200)
		expect(res3.status).toBe(200)
	})

	describe('handle local parse event', async () => {
		const app = new Elysia({ aot: false }).post('/', (ctx) => ctx.body, {
			parse: (ctx, contentType) => {
				return contentType
			},
			body: t.String()
		})

		const res = await app.handle(
			new Request('http://localhost', {
				method: 'POST',
				body: 'yay',
				headers: { 'content-type': 'text/plain' }
			})
		)

		expect(await res.text()).toBe('text/plain')
	})
})
