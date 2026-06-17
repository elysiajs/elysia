/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import { Elysia, t, status } from '../../src'
import { post, req } from '../utils'

describe('Macro', () => {
	it('trace back', async () => {
		let answer: string | undefined

		const app = new Elysia()
			.macro({
				hi(config: string) {
					answer = config
				}
			})
			.get(
				'/',
				{
					hi: 'Hello World'
				},
				() => 'Hello World'
			)

		await app.handle(req('/'))

		expect(answer).toBe('Hello World')
	})

	it('work', async () => {
		const app = new Elysia()
			.macro({
				hi(beforeHandle: () => any) {
					return {
						beforeHandle
					}
				}
			})
			.get(
				'/',
				{
					hi: () => 'Hello World'
				},
				() => 'Hello World'
			)

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('Hello World')
	})

	it('appends parse', async () => {
		const app = new Elysia()
			.macro({
				hi(fn: () => any) {
					return {
						parse: fn
					}
				}
			})
			.get(
				'/',
				{
					hi: () => {}
				},
				() => 'Hello World'
			)

		expect(app.history![0][4]!.parse?.length).toEqual(1)
	})

	it('appends parse array', async () => {
		const app = new Elysia()
			.macro({
				hi(fn: () => any) {
					return {
						parse: [fn, () => {}]
					}
				}
			})
			.get(
				'/',
				{
					hi: () => {}
				},
				() => 'Hello World'
			)

		expect(app.history![0][4]!.parse?.length).toEqual(2)
	})

	it('appends transform', async () => {
		const app = new Elysia()
			.macro({
				hi(fn: () => any) {
					return {
						transform: fn
					}
				}
			})
			.get(
				'/',
				{
					hi: () => {}
				},
				() => 'Hello World'
			)

		expect(app.history![0][4]!.transform?.length).toEqual(1)
	})

	it('appends transform array', async () => {
		const app = new Elysia()
			.macro({
				hi(fn: () => any) {
					return {
						transform: [fn, () => {}]
					}
				}
			})
			.get(
				'/',
				{
					hi: () => {}
				},
				() => 'Hello World'
			)

		expect(app.history![0][4]!.transform?.length).toEqual(2)
	})

	it('appends beforeHandle', async () => {
		const app = new Elysia()
			.macro({
				hi(fn: () => any) {
					return {
						beforeHandle: fn
					}
				}
			})
			.get(
				'/',
				{
					hi: () => {}
				},
				() => 'Hello World'
			)

		expect(app.history![0][4]!.beforeHandle?.length).toEqual(1)
	})

	it('appends beforeHandle array', async () => {
		const app = new Elysia()
			.macro({
				hi(fn: () => any) {
					return {
						beforeHandle: [fn, () => {}]
					}
				}
			})
			.get(
				'/',
				{
					hi: () => {}
				},
				() => 'Hello World'
			)

		expect(app.history![0][4]!.beforeHandle?.length).toEqual(2)
	})

	it('appends afterHandle', async () => {
		const app = new Elysia()
			.macro({
				hi(fn: () => any) {
					return {
						afterHandle: fn
					}
				}
			})
			.get(
				'/',
				{
					hi: () => {}
				},
				() => 'Hello World'
			)

		expect(app.history![0][4]!.afterHandle?.length).toEqual(1)
	})

	it('appends afterHandle array', async () => {
		const app = new Elysia()
			.macro({
				hi(fn: () => any) {
					return {
						afterHandle: [fn, () => {}]
					}
				}
			})
			.get(
				'/',
				{
					hi: () => {}
				},
				() => 'Hello World'
			)

		expect(app.history![0][4]!.afterHandle?.length).toEqual(2)
	})

	it('appends error', async () => {
		const app = new Elysia()
			.macro({
				hi(fn: () => any) {
					return {
						error: fn
					}
				}
			})
			.get(
				'/',
				{
					hi: () => {}
				},
				() => 'Hello World'
			)

		expect(app.history![0][4]!.error?.length).toEqual(1)
	})

	it('appends error array', async () => {
		const app = new Elysia()
			.macro({
				hi(fn: () => any) {
					return {
						error: [fn, () => {}]
					}
				}
			})
			.get(
				'/',
				{
					hi: () => {}
				},
				() => 'Hello World'
			)

		expect(app.history![0][4]!.error?.length).toEqual(2)
	})

	it('appends afterResponse', async () => {
		const app = new Elysia()
			.macro({
				hi(fn: () => any) {
					return {
						afterResponse: fn
					}
				}
			})
			.get(
				'/',
				{
					hi: () => {}
				},
				() => 'Hello World'
			)

		expect(app.history![0][4]!.afterResponse?.length).toEqual(1)
	})

	it('appends afterResponse array', async () => {
		const app = new Elysia()
			.macro({
				hi(fn: () => any) {
					return {
						afterResponse: [fn, () => {}]
					}
				}
			})
			.get(
				'/',
				{
					hi: () => {}
				},
				() => 'Hello World'
			)

		expect(app.history![0][4]!.afterResponse?.length).toEqual(2)
	})

	it('handle deduplication', async () => {
		let call = 0

		const a = new Elysia({ name: 'a', seed: 'awdawd' }).macro({
			a: {
				beforeHandle() {
					call++
				}
			}
		})

		const b = new Elysia({ name: 'b', seed: 'add' })
			.use(a)
			.decorate('b', 'b')

		const app = new Elysia()
			.use(a)
			.use(b)
			.get(
				'/',
				{
					a: true
				},
				() => 'Hello World'
			)

		await app.handle(req('/'))

		expect(call).toBe(1)
	})

	it('propagate macro without inaccurate deduplication in guard', async () => {
		let call = 0

		const base = new Elysia({ name: 'base' }).macro({
			auth(role: 'teacher' | 'student' | 'admin' | 'noLogin') {
				return {
					beforeHandle() {
						call++
					}
				}
			}
		})

		const app = new Elysia()
			// ? Deduplication check
			.use(base)
			.use(base)
			.use(base)
			.use(base)
			.guard({ auth: 'admin' }, (route) =>
				route
					.get('/test1', () => 'test1')
					.get('/test2', () => 'test2')
					.get('/test3', () => 'hello test3')
			)
			.get('/hello', { auth: 'teacher' }, () => 'hello')

		await Promise.all(
			['/test1', '/test2', '/test3'].map((x) => app.handle(req(x)))
		)

		expect(call).toBe(3)
	})

	it('inherits macro from plugin without name', async () => {
		let called = 0

		const plugin = new Elysia().macro({
			hi(_: string) {
				called++
			}
		})

		const app = new Elysia()
			.use(plugin)
			.use(plugin)
			.use(plugin)
			.get(
				'/',
				{
					hi: 'Hello World'
				},
				() => 'Hello World'
			)

		await app.handle(req('/'))

		expect(called).toBe(1)
	})

	it('handle macro from plugin', async () => {
		const authGuard = new Elysia().macro({
			requiredUser(value: boolean) {
				return {
					beforeHandle: async () => {
						if (value)
							return status(401, {
								code: 'S000002',
								message: 'Unauthorized'
							})
					}
				}
			}
		})

		const testRoute = new Elysia({
			prefix: '/test',
			name: 'testRoute'
		})
			.use(authGuard)
			.guard({
				requiredUser: true
			})
			.get('/', () => 'Ely')

		const app = new Elysia().use(testRoute).get('/', () => 'Ely')

		const ok = await app.handle(req('/')).then((t) => t.text())
		const err = await app.handle(req('/test')).then((t) => t.text())

		expect(ok).toBe('Ely')
		expect(err).not.toBe('Ely')
		expect(err).not.toBe('NOT_FOUND')
	})

	it("don't duplicate call on as plugin", async () => {
		let called = 0

		const plugin = new Elysia()
			.macro({
				count(_: boolean) {
					return {
						beforeHandle(ctx) {
							called++
						}
					}
				}
			})
			.get(
				'/',
				{
					count: true
				},
				() => 'hi'
			)

		const app = new Elysia().use(plugin).get(
			'/foo',
			{
				count: true
			},
			() => 'foo'
		)

		await app.handle(req('/'))
	})

	it('inherits macro in group', async () => {
		const authGuard = new Elysia().macro({
			isAuth(shouldAuth: boolean) {
				if (shouldAuth)
					return {
						beforeHandle({ cookie: { session }, status }) {
							if (!session.value) return status(418)
						}
					}
			}
		})

		const app = new Elysia().use(authGuard).group('/posts', (app) =>
			app.get(
				'/',
				{
					isAuth: true
				},
				() => 'a'
			)
		)

		const status = await app.handle(req('/posts')).then((x) => x.status)

		expect(status).toBe(418)
	})

	it('inherits macro in guard', async () => {
		const authGuard = new Elysia().macro({
			isAuth(shouldAuth: boolean) {
				if (shouldAuth)
					return {
						beforeHandle({ cookie: { session }, status }) {
							if (!session.value) return status(418)
						}
					}
			}
		})

		const app = new Elysia().use(authGuard).guard({}, (app) =>
			app.get(
				'/posts',
				{
					isAuth: true
				},
				() => 'a'
			)
		)

		const status = await app.handle(req('/posts')).then((x) => x.status)

		expect(status).toBe(418)
	})

	it('inherits macro from plugin', async () => {
		const authGuard = new Elysia().macro({
			isAuth(shouldAuth: boolean) {
				if (shouldAuth)
					return {
						beforeHandle({ cookie: { session }, status }) {
							if (!session.value) return status(418)
						}
					}
			}
		})

		const app = new Elysia().use(authGuard).use((app) =>
			app.get(
				'/posts',
				{
					isAuth: true
				},
				() => 'a'
			)
		)

		const status = await app.handle(req('/posts')).then((x) => x.status)

		expect(status).toBe(418)
	})

	it("don't inherits macro to plugin without type reference", () => {
		const called = <string[]>[]

		const plugin = new Elysia().get(
			'/hello',
			{
				// @ts-ignore
				hello: 'nagisa'
			},
			() => 'hello'
		)

		const app = new Elysia()
			.macro({
				hello(a: string) {
					called.push(a)
				}
			})
			.use(plugin)
			.get(
				'/',
				{
					// @ts-ignore
					hello: 'hifumi'
				},
				() => 'a'
			)

		// Macros run during route compilation; reading `app.history`
		// triggers compile for each route via the introspection getter.
		void app.history

		expect(called).toEqual(['nagisa', 'hifumi'])
	})

	it("don't duplicate macro call", async () => {
		let registered = 0
		let called = 0

		const a = new Elysia({ name: 'a' }).macro({
			isSignIn() {
				registered++

				return {
					beforeHandle() {
						called++
					}
				}
			}
		})

		const b = new Elysia({ name: 'b' }).use(a)
		const c = new Elysia().use(b).get(
			'/',
			{
				isSignIn: true
			},
			() => 'ok'
		)

		const app = new Elysia().use(c)

		await app.handle(req('/'))

		expect(registered).toBe(1)
		expect(called).toBe(1)
	})

	it('accept resolve', async () => {
		const app = new Elysia()
			.macro({
				user: (enabled: boolean) => ({
					derive: ({ query: { name = 'anon' } }) => ({
						user: {
							name
						}
					})
				})
			})
			.get(
				'/',
				{
					user: true
				},
				({ user }) => user
			)

		const [a, b] = await Promise.all([
			app.handle(req('/')).then((x) => x.json()),
			app.handle(req('/?name=hoshino')).then((x) => x.json())
		])

		expect(a).toEqual({ name: 'anon' })
		expect(b).toEqual({ name: 'hoshino' })
	})

	it('accept async resolve', async () => {
		const app = new Elysia()
			.macro({
				user: (enabled: boolean) => ({
					derive: async ({ query: { name = 'anon' } }) => ({
						user: {
							name
						}
					})
				})
			})
			.get(
				'/',
				{
					user: true
				},
				({ user }) => user
			)

		const [a, b] = await Promise.all([
			app.handle(req('/')).then((x) => x.json()),
			app.handle(req('/?name=hoshino')).then((x) => x.json())
		])

		expect(a).toEqual({ name: 'anon' })
		expect(b).toEqual({ name: 'hoshino' })
	})

	it('guard handle resolve macro', async () => {
		const plugin = new Elysia()
			.macro({
				account: (a: boolean) => ({
					derive: () => ({
						account: 'A'
					})
				})
			})
			.guard({
				account: true
			})
			.get('/local', ({ account }) => account === 'A')

		const parent = new Elysia()
			.use(plugin)
			.get('/plugin', (context) => !('account' in context))

		const app = new Elysia()
			.use(parent)
			.get('/global', (context) => !('account' in context))

		await expect(
			Promise.all(
				['/local', '/plugin', '/global'].map((path) =>
					app
						.handle(req(path))
						.then((x) => x.text())
						.then((x) => x === 'true')
				)
			)
		).resolves.toEqual([true, true, true])
	})

	it('guard handle resolve macro with scoped', async () => {
		const plugin = new Elysia()
			.macro({
				account: (a: boolean) => ({
					derive: () => ({
						account: 'A'
					})
				})
			})
			.guard('plugin', {
				account: true
			})
			.get('/local', ({ account }) => account === 'A')

		const parent = new Elysia()
			.use(plugin)
			.get('/plugin', ({ account }) => account === 'A')

		const app = new Elysia()
			.use(parent)
			.get('/global', (context) => !('account' in context))

		await expect(
			Promise.all(
				['/local', '/plugin', '/global'].map((path) =>
					app
						.handle(req(path))
						.then((x) => x.text())
						.then((x) => x === 'true')
				)
			)
		).resolves.toEqual([true, true, true])
	})

	it('guard handle resolve macro with global', async () => {
		const plugin = new Elysia()
			.macro({
				account: (a: boolean) => ({
					derive: () => ({
						account: 'A'
					})
				})
			})
			.guard('global', {
				account: true
			})
			.get('/local', ({ account }) => account === 'A')

		const parent = new Elysia()
			.use(plugin)
			.get('/plugin', ({ account }) => account === 'A')

		const app = new Elysia()
			.use(parent)
			.get('/global', ({ account }) => account === 'A')

		await expect(
			Promise.all(
				['/local', '/plugin', '/global'].map((path) =>
					app
						.handle(req(path))
						.then((x) => x.text())
						.then((x) => x === 'true')
				)
			)
		).resolves.toEqual([true, true, true])
	})

	it('guard handle resolve macro with local', async () => {
		const plugin = new Elysia()
			.macro({
				account: (a: boolean) => ({
					derive: () => ({
						account: 'A'
					})
				})
			})
			.guard('local', {
				account: true
			})
			.get('/local', ({ account }) => account === 'A')

		const parent = new Elysia()
			.use(plugin)
			.get('/plugin', (context) => !('account' in context))

		const app = new Elysia()
			.use(parent)
			.get('/global', (context) => !('account' in context))

		await expect(
			Promise.all(
				['/local', '/plugin', '/global'].map((path) =>
					app
						.handle(req(path))
						.then((x) => x.text())
						.then((x) => x === 'true')
				)
			)
		).resolves.toEqual([true, true, true])
	})

	it('guard handle resolve macro with error', async () => {
		const plugin = new Elysia()
			.macro({
				account: (a: boolean) => ({
					derive: () => {
						if (Math.random() > 2) return status(401)

						return {
							account: 'A'
						}
					}
				})
			})
			.guard({
				account: true
			})
			.get('/local', ({ account }) => account === 'A')

		const parent = new Elysia()
			.use(plugin)
			.get('/plugin', (context) => !('account' in context))

		const app = new Elysia()
			.use(parent)
			.get('/global', (context) => !('account' in context))

		await expect(
			Promise.all(
				['/local', '/plugin', '/global'].map((path) =>
					app
						.handle(req(path))
						.then((x) => x.text())
						.then((x) => x === 'true')
				)
			)
		).resolves.toEqual([true, true, true])
	})

	it('guard handle resolve macro with async', async () => {
		const plugin = new Elysia()
			.macro({
				account: (a: boolean) => ({
					derive: async () => {
						if (Math.random() > 2) return status(401)

						return {
							account: 'A'
						}
					}
				})
			})
			.guard('plugin', {
				account: true
			})
			.get('/local', ({ account }) => account === 'A')

		const parent = new Elysia()
			.use(plugin)
			.get('/plugin', ({ account }) => account === 'A')

		const app = new Elysia()
			.use(parent)
			.get('/global', (context) => !('account' in context))

		await expect(
			Promise.all(
				['/local', '/plugin', '/global'].map((path) =>
					app
						.handle(req(path))
						.then((x) => x.text())
						.then((x) => x === 'true')
				)
			)
		).resolves.toEqual([true, true, true])
	})

	// It may look duplicate to the test case above, but it occurs for some reason
	it('handle macro resolve', async () => {
		const app = new Elysia()
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

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			hello: 'hanabi'
		})
	})

	it('handle function macro shorthand property', async () => {
		const app = new Elysia()
			.macro({
				user: {
					derive: ({ query: { name = 'anon' } }) => ({
						user: {
							name
						}
					})
				}
			})
			.get(
				'/',
				{
					user: true
				},
				({ user }) => user
			)
			.get(
				'/no-macro',
				{
					user: false
				},
				// @ts-expect-error
				(context) => context?.user ?? { name: 'none' }
			)

		const [a, b, c, d] = await Promise.all([
			app.handle(req('/')).then((x) => x.json()),
			app.handle(req('/?name=hoshino')).then((x) => x.json()),
			app.handle(req('/no-macro')).then((x) => x.json()),
			app.handle(req('/no-macro?name=hoshino')).then((x) => x.json())
		])

		expect(a).toEqual({ name: 'anon' })
		expect(b).toEqual({ name: 'hoshino' })
		expect(c).toEqual({ name: 'none' })
		expect(d).toEqual({ name: 'none' })
	})

	it('handle multiple macros in a route handler', async () => {
		const app = new Elysia()
			.macro({
				a: {
					derive: () => ({ a: 'a' as const })
				},
				b: {
					derive: () => ({ b: 'b' as const })
				},
				c: (n: number) => ({
					derive: () => ({ c: n })
				})
			})
			.get(
				'/a',
				{
					a: true,
					response: t.Object({ a: t.Literal('a') })
				},
				({ a }) => ({ a })
			)
			.get(
				'/b',
				{
					b: true,
					response: t.Object({ b: t.Literal('b') })
				},
				({ b }) => ({ b })
			)
			.get(
				'/c',
				{
					a: true,
					b: true,
					response: t.Object({ a: t.Literal('a'), b: t.Literal('b') })
				},
				({ a, b }) => ({ a, b })
			)
			.get(
				'/d',
				{
					a: true,
					b: false,
					response: t.Object({ a: t.Literal('a'), b: t.Undefined() })
				},
				({
					a,
					// @ts-expect-error Property `b` does not exist
					b
				}) => ({ a, b })
			)
			.get(
				'/e',
				{
					b: true,
					c: 10,
					response: t.Object({
						a: t.Undefined(),
						b: t.Literal('b'),
						c: t.Number()
					})
				},
				({
					// @ts-expect-error Property `a` does not exist
					a,
					b,
					c
				}) => ({ a, b, c })
			)

		const [a, b, c, d, e] = await Promise.all([
			app.handle(req('/a')).then((x) => x.json()),
			app.handle(req('/b')).then((x) => x.json()),
			app.handle(req('/c')).then((x) => x.json()),
			app.handle(req('/d')).then((x) => x.json()),
			app.handle(req('/e')).then((x) => x.json())
		])

		expect(a).toEqual({ a: 'a' })
		expect(b).toEqual({ b: 'b' })
		expect(c).toEqual({ a: 'a', b: 'b' })
		expect(d).toEqual({ a: 'a', b: undefined })
		expect(e).toEqual({ a: undefined, b: 'b', c: 10 })
	})

	it('validate', async () => {
		const app = new Elysia()
			.macro({
				sartre: {
					params: t.Object({ sartre: t.Literal('Sartre') })
				},
				focou: {
					query: t.Object({ focou: t.Literal('Focou') })
				},
				lilith: {
					body: t.Object({ lilith: t.Literal('Lilith') })
				}
			})
			.post(
				'/:sartre',
				{
					sartre: true,
					focou: true,
					lilith: true
				},
				({ body }) => body
			)

		expect(app.history![0][4]!.schemas!.length).toBe(1)

		const valid = await app.handle(
			post('/Sartre?focou=Focou', {
				lilith: 'Lilith'
			})
		)

		expect(valid.status).toBe(200)
		await expect(valid.json()).resolves.toEqual({
			lilith: 'Lilith'
		})

		const invalid1 = await app.handle(
			post('/Sartre?focou=Focou', {
				lilith: 'Not Lilith'
			})
		)

		expect(invalid1.status).toBe(422)

		const invalid2 = await app.handle(
			post('/Not Sartre?focou=Focou', {
				lilith: 'Lilith'
			})
		)

		expect(invalid2.status).toBe(422)

		const invalid3 = await app.handle(
			post('/Sartre?focou=Not Focou', {
				lilith: 'Lilith'
			})
		)

		expect(invalid3.status).toBe(422)
	})

	it('merge validation', async () => {
		const app = new Elysia()
			.macro({
				sartre: {
					body: t.Object({ sartre: t.Literal('Sartre') })
				},
				focou: {
					body: t.Object({ focou: t.Literal('Focou') })
				},
				lilith: {
					body: t.Object({ lilith: t.Literal('Lilith') })
				}
			})
			.post(
				'/',
				{
					sartre: true,
					focou: true,
					lilith: true
				},
				({ body }) => body
			)

		expect(app.history![0][4]!.schemas!.length).toBe(3)

		const response = await app.handle(
			post('/', {
				sartre: 'Sartre',
				focou: 'Focou',
				lilith: 'Lilith'
			})
		)

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			sartre: 'Sartre',
			focou: 'Focou',
			lilith: 'Lilith'
		})

		const invalid1 = await app.handle(
			post('/', {
				sartre: 'Not Sartre',
				focou: 'Focou',
				lilith: 'Lilith'
			})
		)

		expect(invalid1.status).toBe(422)

		const invalid2 = await app.handle(
			post('/', {
				sartre: 'Sartre',
				focou: 'Not Focou',
				lilith: 'Lilith'
			})
		)

		expect(invalid2.status).toBe(422)

		const invalid3 = await app.handle(
			post('/', {
				sartre: 'Sartre',
				focou: 'Focou',
				lilith: 'Not Lilith'
			})
		)

		expect(invalid3.status).toBe(422)
	})

	it('extends', async () => {
		const app = new Elysia()
			.macro({
				sartre: {
					body: t.Object({ sartre: t.Literal('Sartre') })
				},
				focou: {
					body: t.Object({ focou: t.Literal('Focou') })
				},
				lilith: {
					sartre: true,
					focou: true,
					body: t.Object({ lilith: t.Literal('Lilith') })
				}
			})
			.post(
				'/',
				{
					lilith: true
				},
				({ body }) => body
			)

		expect(app.history![0][4]!.schemas!.length).toBe(3)

		const response = await app.handle(
			post('/', {
				sartre: 'Sartre',
				focou: 'Focou',
				lilith: 'Lilith'
			})
		)

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			sartre: 'Sartre',
			focou: 'Focou',
			lilith: 'Lilith'
		})

		const invalid1 = await app.handle(
			post('/', {
				sartre: 'Not Sartre',
				focou: 'Focou',
				lilith: 'Lilith'
			})
		)

		expect(invalid1.status).toBe(422)

		const invalid2 = await app.handle(
			post('/', {
				sartre: 'Sartre',
				focou: 'Not Focou',
				lilith: 'Lilith'
			})
		)

		expect(invalid2.status).toBe(422)

		const invalid3 = await app.handle(
			post('/', {
				sartre: 'Sartre',
				focou: 'Focou',
				lilith: 'Not Lilith'
			})
		)

		expect(invalid3.status).toBe(422)
	})

	// registering a macro must not change route-local schema semantics:
	// route-local fields stay in the override channel (SS1 "override
	// everywhere") instead of being lifted into the additive schemas
	// channel — previously the first applyMacro call in a process lifted
	// them (one-shot iterator bug), making validation process-order
	// dependent: identical routes returned 422 (route 1) vs 200 (route 2)
	it('keep route-local schema override under guard regardless of route order', async () => {
		const app = new Elysia()
			.macro({
				lilith: {
					query: t.Object({ user: t.Literal('Lilith') })
				}
			})
			.guard({
				body: t.Object({ name: t.String() })
			})
			.post(
				'/first',
				{
					body: t.Object({ id: t.Number() })
				},
				({ body }) => body
			)
			.post(
				'/second',
				{
					body: t.Object({ id: t.Number() })
				},
				({ body }) => body
			)
			.post(
				'/macro',
				{
					lilith: true,
					body: t.Object({ id: t.Number() })
				},
				({ body }) => body
			)

		// route-local body stays in the override channel, never lifted
		expect(app.history![0][4]!.body).not.toBeUndefined()
		expect(app.history![0][4]!.schemas).toBeUndefined()
		expect(app.history![1][4]!.body).not.toBeUndefined()
		expect(app.history![1][4]!.schemas).toBeUndefined()

		// { id } fails the guard's body but passes the route-local one:
		// 200 proves the route-local schema overrides the guard's,
		// identically on both routes
		const second = await app.handle(post('/second', { id: 1 }))
		const first = await app.handle(post('/first', { id: 1 }))

		expect(second.status).toBe(200)
		expect(first.status).toBe(200)
		await expect(second.json()).resolves.toEqual({ id: 1 })
		await expect(first.json()).resolves.toEqual({ id: 1 })

		// the route-local schema is still enforced, not dropped
		const invalidFirst = await app.handle(post('/first', { name: 'a' }))
		const invalidSecond = await app.handle(post('/second', { name: 'a' }))

		expect(invalidFirst.status).toBe(422)
		expect(invalidSecond.status).toBe(422)

		// a macro-produced direct schema field is additive and
		// still validates on the consuming route
		const validMacro = await app.handle(
			post('/macro?user=Lilith', { id: 1 })
		)
		expect(validMacro.status).toBe(200)

		const invalidMacro = await app.handle(
			post('/macro?user=Eve', { id: 1 })
		)
		expect(invalidMacro.status).toBe(422)
	})

	it('create detail if not exists', () => {
		const app = new Elysia()
			.macro({
				lilith: {
					detail: {
						summary: 'Lilith',
						description: 'Lilith description'
					}
				}
			})
			.post(
				'/',
				{
					lilith: true
				},
				({ body }) => body
			)

		const route = app.history![0]

		expect(route[4]!.detail).toEqual({
			summary: 'Lilith',
			description: 'Lilith description'
		})
	})

	it('modify detail', () => {
		const app = new Elysia()
			.macro({
				lilith: {
					detail: {
						summary: 'Lilith'
					}
				}
			})
			.post(
				'/',
				{
					lilith: true,
					detail: {
						description: 'Lilith description'
					}
				},
				({ body }) => body
			)

		const route = app.history![0]

		expect(route[4]!.detail).toEqual({
			summary: 'Lilith',
			description: 'Lilith description'
		})
	})

	it('deduplicate static object default', () => {
		const app = new Elysia()
			.macro({
				sartre: {
					body: t.Object({ sartre: t.Literal('Sartre') })
				},
				focou: {
					sartre: true,
					body: t.Object({ focou: t.Literal('Focou') })
				},
				lilith: {
					sartre: true,
					focou: true,
					body: t.Object({ lilith: t.Literal('Lilith') })
				}
			})
			.post(
				'/',
				{
					lilith: true
				},
				({ body }) => body
			)

		const route = app.history![0]

		expect(route[4]!.schemas!.length).toBe(3)
	})

	it('deduplicate function macro by default', () => {
		const app = new Elysia()
			.macro({
				sartre(enabled: boolean) {
					return {
						body: t.Object({ sartre: t.Literal('Sartre') })
					}
				},
				focou: {
					sartre: true,
					body: t.Object({ focou: t.Literal('Focou') })
				},
				lilith: {
					sartre: true,
					focou: true,
					body: t.Object({ lilith: t.Literal('Lilith') })
				}
			})
			.post(
				'/',
				{
					lilith: true,
					sartre: false
				},
				({ body }) => body
			)

		const route = app.history![0]

		// This is 4 because
		// 1. lilith
		// 2. focou
		// 3. sartre from focou
		// 4. sartre with false flag
		expect(route[4]!.schemas!.length).toBe(4)
	})

	it('deduplicate function macro when argument is similar', () => {
		const app = new Elysia()
			.macro({
				sartre(enabled: boolean) {
					return {
						body: t.Object({ sartre: t.Literal('Sartre') })
					}
				},
				focou: {
					sartre: true,
					body: t.Object({ focou: t.Literal('Focou') })
				},
				lilith: {
					sartre: true,
					focou: true,
					body: t.Object({ lilith: t.Literal('Lilith') })
				}
			})
			.post(
				'/',
				{
					lilith: true,
					sartre: true
				},
				({ body }) => body
			)

		const route = app.history![0]

		// This is 4 because
		// 1. lilith
		// 2. focou
		// 3. sartre from focou
		expect(route[4]!.schemas!.length).toBe(3)
	})

	it('deduplicate programmatically', () => {
		const app = new Elysia()
			.macro({
				sartre(tag: string) {
					return {
						seed: tag,
						body: t.Object({ sartre: t.Literal('Sartre') }),
						detail: {
							tags: [tag]
						}
					}
				},
				focou: {
					sartre: 'npc',
					body: t.Object({ focou: t.Literal('Focou') })
				},
				lilith: {
					sartre: 'philosopher',
					focou: true,
					body: t.Object({ lilith: t.Literal('Lilith') })
				}
			})
			.post(
				'/',
				{
					lilith: true
				},
				({ body }) => body
			)

		const route = app.history![0]

		expect(route[4]!.schemas!.length).toBe(4)
		expect(route[4]!.detail).toEqual({
			tags: ['philosopher', 'npc']
		})
	})

	it('handle macro name', async () => {
		const app = new Elysia()
			.macro({
				sartre: {
					params: t.Object({ sartre: t.Literal('Sartre') })
				}
			})
			.macro({
				focou: {
					query: t.Object({ focou: t.Literal('Focou') })
				},
				lilith: {
					body: t.Object({ lilith: t.Literal('Lilith') })
				}
			})
			.post(
				'/:sartre',
				{
					sartre: true,
					focou: true,
					lilith: true
				},
				({ body }) => body
			)

		expect(app.history![0][4]!.schemas!.length).toBe(1)

		const valid = await app.handle(
			post('/Sartre?focou=Focou', {
				lilith: 'Lilith'
			})
		)

		expect(valid.status).toBe(200)
		await expect(valid.json()).resolves.toEqual({
			lilith: 'Lilith'
		})

		const invalid1 = await app.handle(
			post('/Sartre?focou=Focou', {
				lilith: 'Not Lilith'
			})
		)

		expect(invalid1.status).toBe(422)

		const invalid2 = await app.handle(
			post('/Not Sartre?focou=Focou', {
				lilith: 'Lilith'
			})
		)

		expect(invalid2.status).toBe(422)

		const invalid3 = await app.handle(
			post('/Sartre?focou=Not Focou', {
				lilith: 'Lilith'
			})
		)

		expect(invalid3.status).toBe(422)
	})

	it('handle macro name with function', async () => {
		const app = new Elysia()
			.macro({
				sartre: (_: boolean) => ({
					params: t.Object({ sartre: t.Literal('Sartre') })
				})
			})
			.macro({
				focou: {
					query: t.Object({ focou: t.Literal('Focou') })
				},
				lilith: {
					body: t.Object({ lilith: t.Literal('Lilith') })
				}
			})
			.post(
				'/:sartre',
				{
					sartre: true,
					focou: true,
					lilith: true
				},
				({ body }) => body
			)

		expect(app.history![0][4]!.schemas!.length).toBe(1)

		const valid = await app.handle(
			post('/Sartre?focou=Focou', {
				lilith: 'Lilith'
			})
		)

		expect(valid.status).toBe(200)
		await expect(valid.json()).resolves.toEqual({
			lilith: 'Lilith'
		})

		const invalid1 = await app.handle(
			post('/Sartre?focou=Focou', {
				lilith: 'Not Lilith'
			})
		)

		expect(invalid1.status).toBe(422)

		const invalid2 = await app.handle(
			post('/Not Sartre?focou=Focou', {
				lilith: 'Lilith'
			})
		)

		expect(invalid2.status).toBe(422)

		const invalid3 = await app.handle(
			post('/Sartre?focou=Not Focou', {
				lilith: 'Lilith'
			})
		)

		expect(invalid3.status).toBe(422)
	})

	it('handle macro name extends', async () => {
		const app = new Elysia()
			.macro({
				sartre: {
					body: t.Object({ sartre: t.Literal('Sartre') })
				}
			})
			.macro({
				focou: {
					sartre: true,
					body: t.Object({ focou: t.Literal('Focou') })
				},
				lilith: {
					focou: true,
					body: t.Object({ lilith: t.Literal('Lilith') })
				}
			})
			.post(
				'/',
				{
					lilith: true
				},
				({ body }) => body
			)

		expect(app.history![0][4]!.schemas!.length).toBe(3)

		const response = await app.handle(
			post('/', {
				sartre: 'Sartre',
				focou: 'Focou',
				lilith: 'Lilith'
			})
		)

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			sartre: 'Sartre',
			focou: 'Focou',
			lilith: 'Lilith'
		})

		const invalid1 = await app.handle(
			post('/', {
				sartre: 'Not Sartre',
				focou: 'Focou',
				lilith: 'Lilith'
			})
		)

		expect(invalid1.status).toBe(422)

		const invalid2 = await app.handle(
			post('/', {
				sartre: 'Sartre',
				focou: 'Not Focou',
				lilith: 'Lilith'
			})
		)

		expect(invalid2.status).toBe(422)

		const invalid3 = await app.handle(
			post('/', {
				sartre: 'Sartre',
				focou: 'Focou',
				lilith: 'Not Lilith'
			})
		)

		expect(invalid3.status).toBe(422)
	})

	it('rejects a bare functional macro — must be named (A6)', () => {
		// `.macro(fn)` has no name to register under; TS can't catch it (a
		// function is structurally assignable to the open `Macro` record), so
		// without this guard it silently no-ops.
		expect(() =>
			(new Elysia().macro as any)(() => ({ beforeHandle() {} }))
		).toThrow()
	})

	it('accepts a functional macro under its name in the object form', () => {
		const def = () => ({ beforeHandle() {} })
		const app = new Elysia().macro({ a: def as any })

		expect(app['~ext']?.macro?.a).toBe(def)
	})
})
