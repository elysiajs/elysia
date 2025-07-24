// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

import { separateFunction, sucrose } from '../../src/sucrose'
import { req } from '../utils'

describe('sucrose', () => {
	it('common 1', () => {
		expect(
			sucrose({
				handler: function ({ query }) {
					query.a
				},
				afterHandle: [],
				beforeHandle: [],
				error: [
					function a({
						query,
						query: { a, c: d },
						headers: { hello },
						...rest
					}) {
						query.b
						rest.query.e
					},
					({ query: { f } }) => {}
				],
				mapResponse: [],
				afterResponse: [],
				parse: [],
				request: [],
				start: [],
				stop: [],
				trace: [],
				transform: []
			})
		).toEqual({
			query: true,
			headers: true,
			body: false,
			cookie: false,
			set: false,
			server: false,
			path: false,
			url: false,
			route: false
		})
	})

	it('common 2', async () => {
		expect(
			sucrose({
				handler: ({ set, cookie: { auth } }) => {
					console.log(auth.value)
					return ''
				},
				afterHandle: [],
				beforeHandle: [],
				error: [],
				mapResponse: [],
				afterResponse: [],
				parse: [],
				request: [],
				start: [],
				stop: [],
				trace: [],
				transform: []
			})
		).toEqual({
			query: false,
			headers: false,
			body: false,
			cookie: true,
			set: true,
			server: false,
			path: false,
			url: false,
			route: false
		})
	})

	it('integration 1', async () => {
		const path = 'a'

		const app = new Elysia()
			// ✅ easy to perform inference
			.get('/1', ({ query: { a } }) => a)
			.get('/2', ({ query }) => query.a)
			.get('/3', (c) => c.query.a)
			.get('/4', ({ query }) => query[path])
			.get('/5', (c) => c.query[path])

		new Array(5).fill(0).map(async (_, i) => {
			const result = await app
				.handle(req(`/${i + 1}?a=a&b=b`))
				.then((x) => x.text())

			expect(result).toBe('a')
		})
	})

	it('inherits inference from plugin', () => {
		const plugin = new Elysia().derive(({ headers: { authorization } }) => {
			return {
				get auth() {
					return authorization
				}
			}
		})

		const main = new Elysia().use(plugin)

		// @ts-expect-error
		expect(main.inference.headers).toBe(true)
	})

	it("don't link inference", async () => {
		const app = new Elysia({
			cookie: {
				secrets: 'Zero Exception',
				sign: true
			}
		})
			.get('/', () => 'hello')
			.onBeforeHandle(({ cookie: { session }, error }) => {
				if (!session.value) return error(401, 'Unauthorized')
			})

		const status = await app.handle(req('/')).then((x) => x.status)
		expect(status).toBe(200)
	})

	it('mix up chain properties as query', () => {
		expect(
			sucrose({
				handler: async (c) => {
					const id = c.query.id
					const cookie = c.cookie
					return { cookie, id }
				},
				afterHandle: [],
				beforeHandle: [],
				error: [],
				mapResponse: [],
				onResponse: [],
				parse: [],
				request: [],
				start: [],
				stop: [],
				trace: [],
				transform: []
			})
		).toEqual({
			body: false,
			cookie: true,
			headers: false,
			query: true,
			set: false,
			server: false,
			path: false,
			url: false,
			route: false
		})
	})

	it('infer all inferences if context is passed to function', () => {
		expect(
			sucrose({
				handler: function (context) {
					console.log(context)
				},
				afterHandle: [],
				beforeHandle: [],
				error: [],
				mapResponse: [],
				onResponse: [],
				parse: [],
				request: [],
				start: [],
				stop: [],
				trace: [],
				transform: []
			})
		).toEqual({
			query: true,
			headers: true,
			body: true,
			cookie: true,
			set: true,
			server: true,
			path: true,
			url: true,
			route: true
		})
	})

	it('infer all inferences if context is passed to function', () => {
		expect(
			sucrose({
				handler: function ({ ...context }) {
					console.log(context)
				},
				afterHandle: [],
				beforeHandle: [],
				error: [],
				mapResponse: [],
				onResponse: [],
				parse: [],
				request: [],
				start: [],
				stop: [],
				trace: [],
				transform: []
			})
		).toEqual({
			query: true,
			headers: true,
			body: true,
			cookie: true,
			set: true,
			server: true,
			path: true,
			url: true,
			route: true
		})
	})

	it('infer single object destructure property', () => {
		expect(
			sucrose({
				handler: function ({ server }) {
					console.log(server)
				},
				afterHandle: [],
				beforeHandle: [],
				error: [],
				mapResponse: [],
				onResponse: [],
				parse: [],
				request: [],
				start: [],
				stop: [],
				trace: [],
				transform: []
			})
		).toEqual({
			query: false,
			headers: false,
			body: false,
			cookie: false,
			set: false,
			server: true,
			path: false,
			url: false,
			route: false
		})
	})

	it('infer server', async () => {
		const app = new Elysia({ precompile: true })
			.onRequest(({ server }) => {})
			.get('/', () => 'Hello, World!')

		const response = await app.handle(new Request('http://localhost:3000'))

		expect(response.status).toBe(200)
	})

	it('not death lock on empty', async () => {
		const app = new Elysia({ precompile: true })
			.onRequest((c) => {})
			.get('/', () => 'Hello, World!')

		const response = await app.handle(new Request('http://localhost:3000'))

		expect(response.status).toBe(200)
	})

	it('access route, url, path', () => {
		expect(
			sucrose({
				handler: function (context) {
					console.log(context.url, context.path, context.route)
				},
				afterHandle: [],
				beforeHandle: [],
				error: [],
				mapResponse: [],
				onResponse: [],
				parse: [],
				request: [],
				start: [],
				stop: [],
				trace: [],
				transform: []
			})
		).toEqual({
			query: false,
			headers: false,
			body: false,
			cookie: false,
			set: false,
			server: false,
			path: true,
			url: true,
			route: true
		})
	})
})
