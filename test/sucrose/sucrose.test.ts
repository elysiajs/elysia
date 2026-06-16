// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

import {
	separateFunction,
	sucrose,
	clearSucroseCache
} from '../../src/sucrose'
import { req } from '../utils'

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
			server: false,
			path: false,
			url: false,
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

		const status = await app.handle(req('/')).then((x) => x.status)
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
			server: false,
			path: false,
			url: false,
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
			server: true,
			path: true,
			url: true,
			route: true
		})
	})

	it('infer all inferences if context is passed to function', () => {
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
			server: true,
			path: true,
			url: true,
			route: true
		})
	})

	it('infer single object destructure property', () => {
		expect(
			sucrose(
				({ server }) => {
					console.log(server)
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
			server: true,
			path: false,
			url: false,
			route: false
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

		// primitive default (`body = 1`) must not be parsed as the key `body=1`,
		// and a sibling after it must still be seen — regression for the dropped
		// `removeDefaultParameter` call
		expect(
			sucrose(({ body = 1, query }) => {
				console.log(body, query)
			}, lifeCycle)
		).toMatchObject({ body: true, query: true })

		// object default (`headers = {}`) followed by a sibling
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

	it('access route, url, path', () => {
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
			server: false,
			path: true,
			url: true,
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
			server: true,
			path: true,
			url: true,
			route: true
		})
	})

	// Hooks are shared by reference across all routes (ChainNode design), so
	// the same function objects come back on every route compile — sucrose
	// must memoize by function identity instead of paying
	// toString + hash + LRU churn per shared hook (O(routes × hooks) compile
	// cost otherwise)
	it('memoize analysis by function identity', () => {
		const fn = ({ query }) => query.identityMemoProbe

		let stringified = 0
		const original = Function.prototype.toString.bind(fn)
		fn.toString = () => {
			stringified++
			return original()
		}

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
	})
})
