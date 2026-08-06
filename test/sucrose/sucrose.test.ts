// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

import { separateFunction, sucrose, clearSucroseCache } from '../../src/sucrose'
import { post, json } from '../utils'

describe('sucrose', () => {
	it('common 1', () => {
		expect(
			sucrose(
				({ query }) => {
					query.a
				},
				{
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
				}
			)
		).toEqual({
			query: true,
			headers: true,
			body: false,
			cookie: false,
			set: false,
			route: false
		})
	})

	it('common 2', async () => {
		expect(
			sucrose(
				({ set, cookie: { auth } }) => {
					console.log(auth.value)
					return ''
				},
				{
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
				}
			)
		).toEqual({
			query: false,
			headers: false,
			body: false,
			cookie: true,
			set: true,
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
				.handle(`/${i + 1}?a=a&b=b`)
				.then((x) => x.text())

			expect(result).toBe('a')
		})
	})

	it("don't link inference", async () => {
		const app = new Elysia({
			cookie: {
				secrets: 'Zero Exception',
				sign: true
			}
		})
			.get('/', () => 'hello')
			.beforeHandle(({ cookie: { session }, error }) => {
				if (!session.value) return error(401, 'Unauthorized')
			})

		const status = await app.handle('/').then((x) => x.status)
		expect(status).toBe(200)
	})

	it('mix up chain properties as query', () => {
		expect(
			sucrose(
				async (c) => {
					const id = c.query.id
					const cookie = c.cookie
					return { cookie, id }
				},
				{
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
				}
			)
		).toEqual({
			body: false,
			cookie: true,
			headers: false,
			query: true,
			set: false,
			route: false
		})
	})

	it('infer all inferences if context is passed to function', () => {
		expect(
			sucrose(
				(context) => {
					console.log(context)
				},
				{
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
				}
			)
		).toEqual({
			query: true,
			headers: true,
			body: true,
			cookie: true,
			set: true,
			route: true,
			afterResponse: true
		})
	})

	it('infer all inferences if context rest spread is passed to function', () => {
		expect(
			sucrose(
				({ ...context }) => {
					console.log(context)
				},
				{
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
				}
			)
		).toEqual({
			query: true,
			headers: true,
			body: true,
			cookie: true,
			set: true,
			route: true,
			afterResponse: true
		})
	})

	it('infer single object destructure property', () => {
		expect(
			sucrose(
				({ route }) => {
					console.log(route)
				},
				{
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
				}
			)
		).toEqual({
			query: false,
			headers: false,
			body: false,
			cookie: false,
			set: false,
			route: true
		})
	})

	it('infer destructured properties that carry defaults', () => {
		const lifeCycle = {
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
		}

		// Defaults do not become part of the inferred property name.
		expect(
			sucrose(({ body = 1, query }) => {
				console.log(body, query)
			}, lifeCycle)
		).toMatchObject({ body: true, query: true })

		expect(
			sucrose(({ headers = {}, cookie }) => {
				console.log(headers, cookie)
			}, lifeCycle)
		).toMatchObject({ headers: true, cookie: true })
	})

	it('infer server', async () => {
		const app = new Elysia({ precompile: true })
			.request(({ server }) => {})
			.get('/', () => 'Hello, World!')

		const response = await app.handle(new Request('http://localhost:3000'))

		expect(response.status).toBe(200)
	})

	it('not death lock on empty', async () => {
		const app = new Elysia({ precompile: true })
			.request((c) => {})
			.get('/', () => 'Hello, World!')

		const response = await app.handle(new Request('http://localhost:3000'))

		expect(response.status).toBe(200)
	})

	it('access route', () => {
		expect(
			sucrose(
				(context) => {
					console.log(context.url, context.path, context.route)
				},
				{
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
				}
			)
		).toEqual({
			query: false,
			headers: false,
			body: false,
			cookie: false,
			set: false,
			route: true
		})
	})

	it('handle context pass to function with sub context', () => {
		expect(
			sucrose((context) => {
				console.log('path >>> ', context.path)
				console.log(context)
			})
		).toEqual({
			query: true,
			headers: true,
			body: true,
			cookie: true,
			set: true,
			route: true,
			afterResponse: true
		})
	})

	it('infers body from a defaulted destructured context', async () => {
		const app = new Elysia().post(
			'/',
			({ body } = { body: { hello: 'fallback' } }) => body
		)

		const response = await app
			.handle('/', json({ hello: 'world' }))
			.then((x) => x.json())

		expect(response).toEqual({ hello: 'world' })
	})

	it('infers query from a dollar-prefixed arrow parameter', () => {
		const LIFECYCLE = {
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
		}

		const fn = eval('$c=>$c.query.a')
		let result: any
		expect(() => {
			result = sucrose(fn, LIFECYCLE as any)
		}).not.toThrow()
		expect(result.query).toBe(true)
	})

	it('serves routes with a dollar-prefixed arrow parameter', async () => {
		const app = new Elysia().get('/', eval('$c=>$c.query.a'))
		const response = await app.handle(new Request('http://localhost/?a=hi'))
		expect(response.status).toBe(200)
		await expect(response.text()).resolves.toBe('hi')
	})

	it('memoize analysis by function identity', () => {
		const fn = ({ query }) => query.identityMemoProbe

		// The scanner reads source via `Function.prototype.toString.call`
		// (an own `toString` property is treated as a forged source and
		// widens to all-true), so instrument the prototype itself to count
		// stringification
		let stringified = 0
		const original = Function.prototype.toString
		Function.prototype.toString = function () {
			if (this === fn) stringified++
			return original.call(this)
		}

		try {
			const first = sucrose(fn, undefined)
			expect(first.query).toBe(true)
			expect(stringified).toBe(1)

			// identity hit: no re-stringify, identical inference
			const second = sucrose(fn, undefined)
			expect(second).toEqual(first)
			expect(stringified).toBe(1)

			// clearing the sucrose cache must also drop the identity memo so
			// gcTime actually releases the retained inference objects
			clearSucroseCache(0)

			const third = sucrose(fn, undefined)
			expect(third).toEqual(first)
			expect(stringified).toBe(2)
		} finally {
			Function.prototype.toString = original
		}
	})
})
