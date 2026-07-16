// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

import { separateFunction, sucrose, clearSucroseCache } from '../../src/sucrose'
import { post, req } from '../utils'

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

	it('infers body from a defaulted destructured context', async () => {
		const app = new Elysia().post(
			'/',
			({ body } = { body: { hello: 'fallback' } }) => body
		)

		const response = await app
			.handle(post('/', { hello: 'world' }))
			.then((x) => x.json())

		expect(response).toEqual({ hello: 'world' })
	})

	// Regression: $-prefixed single-param arrow (`$c=>$c.query.a`) crashed
	// sucrose with TypeError because the bare-arrow regex (\w+) excluded `$`,
	// landing in the "Unknown case" which returned undefined for body.
	it('dollar-prefix bare-arrow: sucrose does not throw and infers query', () => {
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

	it('dollar-prefix bare-arrow: Elysia route returns 200 with correct body', async () => {
		const app = new Elysia().get('/', eval('$c=>$c.query.a'))
		const response = await app.handle(new Request('http://localhost/?a=hi'))
		expect(response.status).toBe(200)
		expect(await response.text()).toBe('hi')
	})

	// An unclassified use of a context alias must conservatively
	// mark every channel accessed instead of leaving it silently false (which
	// would make codegen skip channel init and the handler read `undefined`).
	// Each of these forms defeats the pattern-based classifier and, before the
	// fix, returned a bare 500 (or wrong value) at runtime.
	describe('conservative context inference', () => {
		it('computed context access c[k] (non-foldable key) returns real data', async () => {
			// `c[k]` where k is not constant-foldable — engine keeps `c[k]` in
			// toString, so the `.query` matcher never sees the channel.
			const app = new Elysia().get('/', (c: any) => {
				const k = ['q', 'uery'].join('')
				return c[k].name
			})

			const response = await app.handle(req('/?name=world'))
			expect(response.status).toBe(200)
			expect(await response.text()).toBe('world')
		})

		it('computed context access c[expr] via non-literal key returns real data', async () => {
			;(globalThis as any).__C19_KEY = 'query'
			const app = new Elysia().get(
				'/',
				(c: any) => c[(globalThis as any).__C19_KEY].name
			)

			const response = await app.handle(req('/?name=zzz'))
			expect(response.status).toBe(200)
			expect(await response.text()).toBe('zzz')
		})

		it('context object spread keeps every channel available', async () => {
			const app = new Elysia().get('/', (c: any) => {
				const copy = { ...c }
				return copy.query.name
			})

			const response = await app.handle(req('/?name=spread'))
			expect(response.status).toBe(200)
			expect(await response.text()).toBe('spread')
		})

		it('arguments[0].query in a function-declaration handler returns real data', async () => {
			const app = new Elysia().get('/', function (c: any) {
				return arguments[0].query.name
			})

			const response = await app.handle(req('/?name=hello'))
			expect(response.status).toBe(200)
			expect(await response.text()).toBe('hello')
		})

		it('spaced member access (c .query) returns real data', async () => {
			// eval keeps the whitespace in the source string; the exact-match
			// `c.query` matcher misses the spaced `c .query` form.
			const app = new Elysia().get(
				'/',
				eval('(c) => { return c .query.name }')
			)

			const response = await app.handle(req('/?name=spaced'))
			expect(response.status).toBe(200)
			expect(await response.text()).toBe('spaced')
		})

		it('whitespace-after-dot access (c.  query) returns real data', async () => {
			const app = new Elysia().get(
				'/',
				eval('(c) => { return c.  query.name }')
			)

			const response = await app.handle(req('/?name=dotspace'))
			expect(response.status).toBe(200)
			expect(await response.text()).toBe('dotspace')
		})

		it('unit: ambiguous forms mark every channel accessed', () => {
			const all = {
				query: true,
				headers: true,
				body: true,
				cookie: true,
				set: true,
				server: true,
				path: true,
				url: true,
				route: true
			}

			expect(
				sucrose(function (c: any) {
					return arguments[0].query.name
				}, undefined)
			).toEqual(all)

			expect(
				sucrose((c: any) => {
					const k = ['q', 'uery'].join('')
					return c[k].name
				}, undefined)
			).toEqual(all)
		})

		it('does not over-infer statically-clear member access', () => {
			// c.query.a must stay precise (query only) — the floor must not nuke
			// inference precision for the common resolvable case.
			expect(sucrose((c: any) => c.query.a, undefined)).toEqual({
				query: true,
				headers: false,
				body: false,
				cookie: false,
				set: false,
				server: false,
				path: false,
				url: false,
				route: false
			})

			// computed access on a *channel* (query[k]) is not ambiguous — the
			// channel itself is already classified.
			expect(
				sucrose((c: any) => {
					const k = 'a'
					return c.query[k]
				}, undefined)
			).toEqual({
				query: true,
				headers: false,
				body: false,
				cookie: false,
				set: false,
				server: false,
				path: false,
				url: false,
				route: false
			})
		})

		it('bounds the previously-quadratic call scan (~31KB body compiles fast)', () => {
			// Build a real function whose stringified body is ~30KB with many
			// `\w(` openers — the old `\w\(.*?ctx.*?\)` regex burned ~225ms here.
			const filler = 'g('.repeat(15000)
			const fn = new Function(
				'ctx',
				`var s=${JSON.stringify(filler)}; return ctx.query.a`
			) as any
			expect(fn.toString().length).toBeGreaterThan(29000)
			expect(fn.toString().length).toBeLessThan(32768)

			const t0 = performance.now()
			const result = sucrose(fn, undefined)
			const elapsed = performance.now() - t0

			expect(elapsed).toBeLessThan(500)
			// ctx only used as `ctx.query.a` (member access, not passed) → precise
			expect(result.query).toBe(true)
			expect(result.body).toBe(false)
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
