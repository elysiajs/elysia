import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'
import z from 'zod'

describe('Edge Case', () => {
	it('handle state', async () => {
		const app = new Elysia()
			.state('a', 'a')
			.get('/', ({ store: { a } }) => a)
		const res = await app.handle(req('/'))

		await expect(res.text()).resolves.toBe('a')
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

	it('handle strict path and loose path', async () => {
		const loose = new Elysia().group('/a', (app) =>
			app.get('/', () => 'Hi')
		)

		await expect(
			loose.handle(req('/a')).then((x) => x.status)
		).resolves.toBe(200)
		await expect(
			loose.handle(req('/a/')).then((x) => x.status)
		).resolves.toBe(200)

		const strict = new Elysia({
			strictPath: true
		}).group('/a', (app) => app.get('/', () => 'Hi'))

		await expect(
			strict.handle(req('/a')).then((x) => x.status)
		).resolves.toBe(404)
		await expect(
			strict.handle(req('/a/')).then((x) => x.status)
		).resolves.toBe(200)
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

		// Routes keep their insertion order in `history`, even when a path
		// repeats — the duplicate stays in place rather than shifting indices.
		expect(app.history!.map((route) => route[1])).toEqual([
			'/0',
			'/1',
			'/2',
			'/3',
			'/1',
			'/4'
		])
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

		// A plugin's routes are appended in order after the parent's own.
		expect(app.history!.map((route) => route[1])).toEqual([
			'/0',
			'/1',
			'/2',
			'/3',
			'/1',
			'/4'
		])
	})

	it('get routes', () => {
		const plugin = new Elysia().get('/', () => 'hello')

		const main = new Elysia().use(plugin).get('/2', () => 'hi')

		expect(main.routes.length).toBe(2)
	})

	it('share one combine node across routes absorbed under the same chain', async () => {
		const called: string[] = []

		const inner = new Elysia()
			.transform(() => {
				called.push('inner')
			})
			.get('/a', () => 'a')
			.get('/b', () => 'b')

		const mid = new Elysia()
			.transform(() => {
				called.push('mid')
			})
			.use(inner)

		const app = new Elysia()
			.transform(() => {
				called.push('app')
			})
			.use(mid)

		// ≥2 hook-bearing `.use` levels make both `route[6]` (the child's
		// inherited chain) and the absorbing chain non-empty, producing a
		// {combine, over} node per absorbed route. Identical (childChain,
		// preChain) pairs must share ONE node — otherwise every ancestor's
		// history retains O(routes × depth) duplicate combine nodes forever.
		const a = app.history!.find((route) => route[1] === '/a')!
		const b = app.history!.find((route) => route[1] === '/b')!

		expect(a[6]).toBeDefined()
		expect(a[6]).toBe(b[6]!)

		// sharing the node must not change hook execution
		const resA = await app.handle(req('/a'))
		await expect(resA.text()).resolves.toBe('a')
		const forA = called.splice(0)

		const resB = await app.handle(req('/b'))
		await expect(resB.text()).resolves.toBe('b')
		const forB = called.splice(0)

		expect(forB).toEqual(forA)
		expect(forA.length).toBeGreaterThan(0)
	})

	it('memoize routes getter until mutation', () => {
		const app = new Elysia().get('/a', () => 'a')

		// repeated reads return the same array identity (cached snapshot,
		// matching `.history` reference semantics) — re-materializing per
		// access makes `app.routes[i]` in a loop quadratic
		const first = app.routes
		expect(app.routes).toBe(first)

		// adding a route invalidates the snapshot
		app.get('/b', () => 'b')

		const second = app.routes
		expect(second).not.toBe(first)
		expect(second.length).toBe(2)
		expect(app.routes).toBe(second)

		// absorbing a plugin (routes + macro + hook) invalidates it too,
		// and macro resolution still applies to the new snapshot
		const plugin = new Elysia()
			.macro({
				tagged: {
					transform: () => {}
				}
			})
			.get('/c', { tagged: true }, () => 'c')

		app.use(plugin)

		const third = app.routes
		expect(third).not.toBe(second)
		expect(third.length).toBe(3)
		expect(
			third.find((route) => route.path === '/c')!.hooks.transform!.length
		).toBe(1)

		// compilation mutates stored hooks in place (hookToGuard /
		// promoteDerive on route[4]) — reads after compile must re-merge
		// instead of serving a stale pre-compile snapshot
		app.compile()
		const fourth = app.routes
		expect(fourth).not.toBe(third)
		expect(
			fourth.find((route) => route.path === '/c')!.hooks.transform!.length
		).toBe(1)
	})

	it('reading routes is idempotent (no hook duplication)', () => {
		const plugin = new Elysia().transform(() => {})
		const app = new Elysia().use(plugin).get(
			'/',
			{
				transform() {}
			},
			() => 'hi'
		)

		const first = app.routes[0].hooks.transform!.length

		// `routes` merges hooks lazily; reading it must not mutate the stored
		// route, so repeated reads return the same shape.
		expect(app.routes[0].hooks.transform!.length).toBe(first)
		expect(app.routes[0].hooks.transform!.length).toBe(first)
	})

	it('value returned from transform has priority over the default value from schema', async () => {
		const route = new Elysia().get(
			'/:propParams?',
			{
				params: t.Object({
					propParams: t.String({
						default: 'params-default'
					})
				}),
				transform({ params }) {
					params.propParams = 'params-transform'
				}
			},
			({ params: { propParams } }) => propParams
		)

		const app = new Elysia().use(route)

		const response = await app
			.handle(new Request('http://localhost'))
			.then((x) => x.text())

		expect(response).toBe('params-transform')
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

	it('handle complex union with json exact mirror, and sanitize', async () => {
		const app = new Elysia({
			sanitize: (v) => v && 'Elysia'
		}).get(
			'/',
			// @ts-ignore
			{
				response: t.Cyclic(
					{
						a: t.Object({
							type: t.String(),
							data: t.Union([
								t.Nullable(t.Ref('a')),
								t.Array(t.Ref('a'))
							])
						})
					},
					'a'
				)
			},
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
			})
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

	it('sanitize cyclic schema nested in object', async () => {
		const app = new Elysia({
			sanitize: (v) => v && 'Elysia'
		}).get(
			'/',
			// @ts-ignore
			{
				response: t.Object({
					wrap: t.Cyclic(
						{
							a: t.Object({
								type: t.String(),
								data: t.Nullable(t.Ref('a'))
							})
						},
						'a'
					),
					extra: t.String()
				})
			},
			() => ({
				wrap: {
					type: 'ok',
					data: { type: 'nested', data: null }
				},
				extra: 'untouched-number-free'
			})
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			wrap: {
				type: 'Elysia',
				data: { type: 'Elysia', data: null }
			},
			extra: 'Elysia'
		})
	})

	it('serve async static route repeatedly', async () => {
		const app = new Elysia().get('/', Promise.resolve(new Response('hi')))

		const first = await app.handle(req('/'))
		expect(first.status).toBe(200)
		await expect(first.text()).resolves.toBe('hi')

		// the resolved Response must be cloned per serve, not consumed
		const second = await app.handle(req('/'))
		expect(second.status).toBe(200)
		await expect(second.text()).resolves.toBe('hi')
	})

	it('sanitize cyclic value at arbitrary depth', async () => {
		let payload: any = { type: 'leaf', data: null }
		for (let i = 0; i < 12; i++) payload = { type: 'node', data: payload }

		const app = new Elysia({
			sanitize: (v) => v && 'Elysia'
		}).get(
			'/',
			// @ts-ignore
			{
				response: t.Cyclic(
					{
						a: t.Object({
							type: t.String(),
							data: t.Union([
								t.Nullable(t.Ref('a')),
								t.Array(t.Ref('a'))
							])
						})
					},
					'a'
				)
			},
			() => payload
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		let node: any = response
		let depth = 0
		while (node.data) {
			expect(node.type).toBe('Elysia')
			node = node.data
			depth++
		}

		expect(depth).toBe(12)
		expect(node.type).toBe('Elysia')
	})

	it('clone hooks before mapping it to usable function while compose', async () => {
		const group = new Elysia()
			.macro({
				user: (enabled: true) => ({
					derive() {
						if (!enabled) return

						return {
							user: 'a'
						}
					}
				})
			})
			.get(
				'/',
				{
					user: true
				},
				({ user, status }) => {
					if (!user) return status(401)

					return { hello: 'hanabi' }
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
		const api = new Elysia().get(
			'/:id',
			{
				params: t.Object({
					id: t.String()
				})
			},
			({ params }) => params
		)

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
			{
				response: t.Object(
					{ keys: t.Array(t.Object({ a: t.Number() })) },
					{ additionalProperties: true }
				)
			},
			() => ({
				keys: [{ a: 1, b: 2 }],
				extra: true
			})
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
					.get('/foo', { response: { 200: t.String() } }, () => 'bar')
					.get('/bar', { response: { 200: t.Integer() } }, () => 12)
		)

		const response = await app.handle(req('/foo'))

		expect(response.status).toBe(200)
	})

	it('automatically handle HEAD request for GET static path', async () => {
		const app = new Elysia({ autoHead: true }).get('/', () => 'hello world')

		const response = await app.handle(
			new Request('http://localhost', {
				method: 'HEAD'
			})
		)

		expect(response.status).toBe(200)
		expect(response.headers.toJSON()).toEqual({
			'content-length': '11'
		})
	})

	it('automatically handle HEAD request for GET dynamic path', async () => {
		const app = new Elysia({ autoHead: true }).get(
			'/:id',
			() => 'hello world'
		)

		const response = await app.handle(
			new Request('http://localhost/1', {
				method: 'HEAD'
			})
		)

		expect(response.status).toBe(200)
		expect(response.headers.toJSON()).toEqual({
			'content-length': '11'
		})
	})

	it('prefer user-provided HEAD over auto-HEAD for GET', async () => {
		const app = new Elysia({ autoHead: true })
			.get('/', () => 'hello world')
			.head('/', ({ set }) => {
				set.headers['x-source'] = 'manual-head'
			})

		const response = await app.handle(
			new Request('http://localhost', {
				method: 'HEAD'
			})
		)

		// The explicit HEAD handler runs (its custom header is present) instead
		// of the GET-derived auto-HEAD (which would carry `content-length: 11`).
		expect(response.status).toBe(200)
		expect(response.headers.get('x-source')).toBe('manual-head')
		expect(response.headers.get('content-length')).not.toBe('11')
	})

	it('prefer user-provided HEAD over auto-HEAD for dynamic GET', async () => {
		const app = new Elysia({ autoHead: true })
			.get('/:id', () => 'hello world')
			.head('/:id', ({ set }) => {
				set.headers['x-source'] = 'manual-head'
			})

		const response = await app.handle(
			new Request('http://localhost/1', {
				method: 'HEAD'
			})
		)

		expect(response.status).toBe(200)
		expect(response.headers.get('x-source')).toBe('manual-head')
	})

	it('auto-HEAD on an infinite-stream GET returns instead of hanging', async () => {
		const app = new Elysia({ autoHead: true }).get(
			'/stream',
			async function* () {
				// Never terminates — the old `arrayBuffer()` content-length path
				// would buffer this forever and hang the HEAD request.
				while (true) {
					yield 'tick'
					await new Promise((resolve) => setTimeout(resolve, 1))
				}
			}
		)

		const result = await Promise.race([
			app.handle(
				new Request('http://localhost/stream', { method: 'HEAD' })
			),
			new Promise<'TIMEOUT'>((resolve) =>
				setTimeout(() => resolve('TIMEOUT'), 250)
			)
		])

		expect(result).not.toBe('TIMEOUT')
		expect((result as Response).status).toBe(200)
		// HEAD must not carry a body
		expect((result as Response).body).toBeNull()
	})

	it('does not auto-register HEAD for GET unless autoHead is enabled', async () => {
		// auto-HEAD is opt-in: without `autoHead`, a HEAD request to a
		// GET-only route has no handler and falls through to 404 rather than
		// silently deriving one from the GET handler.
		const app = new Elysia().get('/', () => 'hello world')

		const response = await app.handle(
			new Request('http://localhost', {
				method: 'HEAD'
			})
		)

		expect(response.status).toBe(404)
	})

	it('handle arbitrary code execution from cookie', async () => {
		const app = new Elysia({
			cookie: {
				secrets: `\` + console.log(c.q='pwn') + \``,
				domain: process.env.COOKIE_DOMAIN || 'localhost'
			}
		}).get(
			'/',
			{
				cookie: t.Cookie({
					foo: t.Optional(t.Any())
				})
			},
			(c) =>
				// @ts-ignore
				c.q ?? 'safe'
		)

		const response = await app
			.handle(req('/?name=saltyaom'))
			.then((x) => x.text())

		expect(response).toBe('safe')
	})

	it('prototype pollution from input', () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				body: z.object({
					data: z.any()
				})
			})
			.post(
				'/',
				{
					body: z.object({
						data: z.object({
							messageId: z.string('pollute-me')
						})
					})
				},
				({ body }) => ({
					body,
					win:
						// @ts-ignore
						{}.foo
				})
			)

		app.handle(
			new Request('http://localhost:3000/', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: `{
					"data": {
						"messageId": "pollute-me",
						"__proto__": {
							"foo": "bar"
						}
					}
				}`
			})
		).then((x) => x.json())
	})
})
