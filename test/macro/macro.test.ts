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
			.get('/', () => 'Hello World', {
				hi: 'Hello World'
			})

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
			.get('/', () => 'Hello World', {
				hi: () => 'Hello World'
			})

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
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.parse?.length).toEqual(1)
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
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.parse?.length).toEqual(2)
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
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.transform?.length).toEqual(1)
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
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.transform?.length).toEqual(2)
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
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.beforeHandle?.length).toEqual(1)
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
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.beforeHandle?.length).toEqual(2)
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
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.afterHandle?.length).toEqual(1)
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
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.afterHandle?.length).toEqual(2)
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
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.error?.length).toEqual(1)
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
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.error?.length).toEqual(2)
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
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.afterResponse?.length).toEqual(1)
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
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.afterResponse?.length).toEqual(2)
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
			.get('/', () => 'Hello World', {
				a: true
			})

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
			.get('/hello', () => 'hello', { auth: 'teacher' })

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
			.get('/', () => 'Hello World', {
				hi: 'Hello World'
			})

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
			.get('/', () => 'hi', {
				count: true
			})

		const app = new Elysia().use(plugin).get('/foo', () => 'foo', {
			count: true
		})

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
			app.get('/', () => 'a', {
				isAuth: true
			})
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
			app.get('/posts', () => 'a', {
				isAuth: true
			})
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
			app.get('/posts', () => 'a', {
				isAuth: true
			})
		)

		const status = await app.handle(req('/posts')).then((x) => x.status)

		expect(status).toBe(418)
	})

	it("don't inherits macro to plugin without type reference", () => {
		const called = <string[]>[]

		const plugin = new Elysia().get('/hello', () => 'hello', {
			// @ts-ignore
			hello: 'nagisa'
		})

		new Elysia()
			.macro({
				hello(a: string) {
					called.push(a)
				}
			})
			.use(plugin)
			.get('/', () => 'a', {
				hello: 'hifumi'
			})

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
		const c = new Elysia().use(b).get('/', () => 'ok', {
			isSignIn: true
		})

		const app = new Elysia().use(c)

		await app.handle(req('/'))

		expect(registered).toBe(1)
		expect(called).toBe(1)
	})

	it('accept resolve', async () => {
		const app = new Elysia()
			.macro({
				user: (enabled: boolean) => ({
					resolve: ({ query: { name = 'anon' } }) => ({
						user: {
							name
						}
					})
				})
			})
			.get('/', ({ user }) => user, {
				user: true
			})

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
					resolve: async ({ query: { name = 'anon' } }) => ({
						user: {
							name
						}
					})
				})
			})
			.get('/', ({ user }) => user, {
				user: true
			})

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
					resolve: () => ({
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

		expect(
			await Promise.all(
				['/local', '/plugin', '/global'].map((path) =>
					app
						.handle(req(path))
						.then((x) => x.text())
						.then((x) => x === 'true')
				)
			)
		).toEqual([true, true, true])
	})

	it('guard handle resolve macro with scoped', async () => {
		const plugin = new Elysia()
			.macro({
				account: (a: boolean) => ({
					resolve: () => ({
						account: 'A'
					})
				})
			})
			.guard({
				as: 'scoped',
				account: true
			})
			.get('/local', ({ account }) => account === 'A')

		const parent = new Elysia()
			.use(plugin)
			.get('/plugin', ({ account }) => account === 'A')

		const app = new Elysia()
			.use(parent)
			.get('/global', (context) => !('account' in context))

		expect(
			await Promise.all(
				['/local', '/plugin', '/global'].map((path) =>
					app
						.handle(req(path))
						.then((x) => x.text())
						.then((x) => x === 'true')
				)
			)
		).toEqual([true, true, true])
	})

	it('guard handle resolve macro with global', async () => {
		const plugin = new Elysia()
			.macro({
				account: (a: boolean) => ({
					resolve: () => ({
						account: 'A'
					})
				})
			})
			.guard({
				as: 'global',
				account: true
			})
			.get('/local', ({ account }) => account === 'A')

		const parent = new Elysia()
			.use(plugin)
			.get('/plugin', ({ account }) => account === 'A')

		const app = new Elysia()
			.use(parent)
			.get('/global', ({ account }) => account === 'A')

		expect(
			await Promise.all(
				['/local', '/plugin', '/global'].map((path) =>
					app
						.handle(req(path))
						.then((x) => x.text())
						.then((x) => x === 'true')
				)
			)
		).toEqual([true, true, true])
	})

	it('guard handle resolve macro with local', async () => {
		const plugin = new Elysia()
			.macro({
				account: (a: boolean) => ({
					resolve: () => ({
						account: 'A'
					})
				})
			})
			.guard({
				as: 'local',
				account: true
			})
			.get('/local', ({ account }) => account === 'A')

		const parent = new Elysia()
			.use(plugin)
			.get('/plugin', (context) => !('account' in context))

		const app = new Elysia()
			.use(parent)
			.get('/global', (context) => !('account' in context))

		expect(
			await Promise.all(
				['/local', '/plugin', '/global'].map((path) =>
					app
						.handle(req(path))
						.then((x) => x.text())
						.then((x) => x === 'true')
				)
			)
		).toEqual([true, true, true])
	})

	it('guard handle resolve macro with error', async () => {
		const plugin = new Elysia()
			.macro({
				account: (a: boolean) => ({
					resolve: () => {
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

		expect(
			await Promise.all(
				['/local', '/plugin', '/global'].map((path) =>
					app
						.handle(req(path))
						.then((x) => x.text())
						.then((x) => x === 'true')
				)
			)
		).toEqual([true, true, true])
	})

	it('guard handle resolve macro with async', async () => {
		const plugin = new Elysia()
			.macro({
				account: (a: boolean) => ({
					resolve: async () => {
						if (Math.random() > 2) return status(401)

						return {
							account: 'A'
						}
					}
				})
			})
			.guard({
				as: 'scoped',
				account: true
			})
			.get('/local', ({ account }) => account === 'A')

		const parent = new Elysia()
			.use(plugin)
			.get('/plugin', ({ account }) => account === 'A')

		const app = new Elysia()
			.use(parent)
			.get('/global', (context) => !('account' in context))

		expect(
			await Promise.all(
				['/local', '/plugin', '/global'].map((path) =>
					app
						.handle(req(path))
						.then((x) => x.text())
						.then((x) => x === 'true')
				)
			)
		).toEqual([true, true, true])
	})

	// It may look duplicate to the test case above, but it occurs for some reason
	it('handle macro resolve', async () => {
		const app = new Elysia()
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

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			hello: 'hanabi'
		})
	})

	it('handle function macro shorthand property', async () => {
		const app = new Elysia()
			.macro({
				user: {
					resolve: ({ query: { name = 'anon' } }) => ({
						user: {
							name
						}
					})
				}
			})
			.get('/', ({ user }) => user, {
				user: true
			})
			// @ts-expect-error
			.get('/no-macro', (context) => context?.user ?? { name: 'none' }, {
				user: false
			})

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
					resolve: () => ({ a: 'a' as const })
				},
				b: {
					resolve: () => ({ b: 'b' as const })
				},
				c: (n: number) => ({
					resolve: () => ({ c: n })
				})
			})
			.get('/a', ({ a }) => ({ a }), {
				a: true,
				response: t.Object({ a: t.Literal('a') })
			})
			.get('/b', ({ b }) => ({ b }), {
				b: true,
				response: t.Object({ b: t.Literal('b') })
			})
			.get('/c', ({ a, b }) => ({ a, b }), {
				a: true,
				b: true,
				response: t.Object({ a: t.Literal('a'), b: t.Literal('b') })
			})
			.get(
				'/d',
				({
					a,
					// @ts-expect-error Property `b` does not exist
					b
				}) => ({ a, b }),
				{
					a: true,
					b: false,
					response: t.Object({ a: t.Literal('a'), b: t.Undefined() })
				}
			)
			.get(
				'/e',
				({
					// @ts-expect-error Property `a` does not exist
					a,
					b,
					// @ts-expect-error Property `c` does not exist
					c
				}) => ({ a, b, c }),
				{
					b: true,
					c: 10,
					response: t.Object({
						a: t.Undefined(),
						b: t.Literal('b'),
						c: t.Number()
					})
				}
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
			.post('/:sartre', ({ body }) => body, {
				sartre: true,
				focou: true,
				lilith: true
			})

		expect(app.routes[0].hooks.standaloneValidator.length).toBe(1)

		const valid = await app.handle(
			post('/Sartre?focou=Focou', {
				lilith: 'Lilith'
			})
		)

		expect(valid.status).toBe(200)
		expect(await valid.json()).toEqual({
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
			.post('/', ({ body }) => body, {
				sartre: true,
				focou: true,
				lilith: true
			})

		expect(app.routes[0].hooks.standaloneValidator.length).toBe(3)

		const response = await app.handle(
			post('/', {
				sartre: 'Sartre',
				focou: 'Focou',
				lilith: 'Lilith'
			})
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
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
			.post('/', ({ body }) => body, {
				lilith: true
			})

		expect(app.routes[0].hooks.standaloneValidator.length).toBe(3)

		const response = await app.handle(
			post('/', {
				sartre: 'Sartre',
				focou: 'Focou',
				lilith: 'Lilith'
			})
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
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
			.post('/', ({ body }) => body, {
				lilith: true
			})

		const route = app.routes[0]

		expect(route.hooks.detail).toEqual({
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
			.post('/', ({ body }) => body, {
				lilith: true,
				detail: {
					description: 'Lilith description'
				}
			})

		const route = app.routes[0]

		expect(route.hooks.detail).toEqual({
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
			.post('/', ({ body }) => body, {
				lilith: true
			})

		const route = app.routes[0]

		expect(route.hooks.standaloneValidator.length).toBe(3)
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
			.post('/', ({ body }) => body, {
				lilith: true,
				sartre: false
			})

		const route = app.routes[0]

		// This is 4 because
		// 1. lilith
		// 2. focou
		// 3. sartre from focou
		// 4. sartre with false flag
		expect(route.hooks.standaloneValidator.length).toBe(4)
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
			.post('/', ({ body }) => body, {
				lilith: true,
				sartre: true
			})

		const route = app.routes[0]

		// This is 4 because
		// 1. lilith
		// 2. focou
		// 3. sartre from focou
		expect(route.hooks.standaloneValidator.length).toBe(3)
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
			.post('/', ({ body }) => body, {
				lilith: true
			})

		const route = app.routes[0]

		expect(route.hooks.standaloneValidator.length).toBe(4)
		expect(route.hooks.detail).toEqual({
			tags: ['philosopher', 'npc']
		})
	})

	it('handle macro name', async () => {
		const app = new Elysia()
			.macro('sartre', {
				params: t.Object({ sartre: t.Literal('Sartre') })
			})
			.macro({
				focou: {
					query: t.Object({ focou: t.Literal('Focou') })
				},
				lilith: {
					body: t.Object({ lilith: t.Literal('Lilith') })
				}
			})
			.post('/:sartre', ({ body }) => body, {
				sartre: true,
				focou: true,
				lilith: true
			})

		expect(app.routes[0].hooks.standaloneValidator.length).toBe(1)

		const valid = await app.handle(
			post('/Sartre?focou=Focou', {
				lilith: 'Lilith'
			})
		)

		expect(valid.status).toBe(200)
		expect(await valid.json()).toEqual({
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
			.macro('sartre', (_: boolean) => ({
				params: t.Object({ sartre: t.Literal('Sartre') })
			}))
			.macro({
				focou: {
					query: t.Object({ focou: t.Literal('Focou') })
				},
				lilith: {
					body: t.Object({ lilith: t.Literal('Lilith') })
				}
			})
			.post('/:sartre', ({ body }) => body, {
				sartre: true,
				focou: true,
				lilith: true
			})

		expect(app.routes[0].hooks.standaloneValidator.length).toBe(1)

		const valid = await app.handle(
			post('/Sartre?focou=Focou', {
				lilith: 'Lilith'
			})
		)

		expect(valid.status).toBe(200)
		expect(await valid.json()).toEqual({
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
			.macro('sartre', {
				body: t.Object({ sartre: t.Literal('Sartre') })
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
			.post('/', ({ body }) => body, {
				lilith: true
			})

		expect(app.routes[0].hooks.standaloneValidator.length).toBe(3)

		const response = await app.handle(
			post('/', {
				sartre: 'Sartre',
				focou: 'Focou',
				lilith: 'Lilith'
			})
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
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

	describe('Macro resolve dependency ordering', () => {
		it('cross-plugin resolve dependency', async () => {
			const order: string[] = []

			const sessionsPlugin = new Elysia().macro({
				sessions: {
					resolve: () => {
						order.push('sessions')
						return {
							sessions: {
								get: () => 'session-data',
								create: () => {},
								delete: () => {}
							}
						}
					}
				}
			})

			const app = new Elysia()
				.use(sessionsPlugin)
				.macro({
					auth: {
						sessions: true,
						resolve: ({ sessions }) => {
							order.push('auth')
							const data = sessions.get()
							return { auth: { currentUser: data } }
						}
					}
				})
				.get('/', ({ auth, sessions }) => ({ auth, hasSessions: !!sessions }), {
					auth: true
				})

			const response = await app.handle(req('/')).then((x) => x.json())

			expect(order).toEqual(['sessions', 'auth'])
			expect(response.auth).toEqual({ currentUser: 'session-data' })
			expect(response.hasessions).not.toBeUndefined
		})

		it('chained dependencies (3 levels deep)', async () => {
			const app = new Elysia()
				.macro({
					a: {
						resolve: () => ({ a: 'a' })
					},
					b: {
						a: true,
						resolve: ({ a }) => ({ b: a + 'b' })
					},
					c: {
						b: true,
						resolve: ({ b }) => ({ c: b + 'c' })
					}
				})
				.get('/', ({ a, b, c }) => ({ a, b, c }), {
					c: true
				})

			const response = await app.handle(req('/')).then((x) => x.json())

			expect(response).toEqual({ a: 'a', b: 'ab', c: 'abc' })
		})

		it('multiple simultaneous dependencies', async () => {
			const app = new Elysia()
				.macro({
					x: {
						resolve: () => ({ x: 'x-value' })
					},
					y: {
						resolve: () => ({ y: 'y-value' })
					},
					combined: {
						x: true,
						y: true,
						resolve: ({ x, y }) => ({
							combined: x + '+' + y
						})
					}
				})
				.get('/', ({ combined, x, y }) => ({ combined, x, y }), {
					combined: true
				})

			const response = await app.handle(req('/')).then((x) => x.json())

			expect(response).toEqual({
				x: 'x-value',
				y: 'y-value',
				combined: 'x-value+y-value'
			})
		})

		it('property declaration order independence', async () => {
			const app = new Elysia()
				.macro({
					base: {
						resolve: () => ({ base: 'base-value' })
					},
					depBefore: {
						base: true,
						resolve: ({ base }) => ({ depBefore: base + '-before' })
					},
					depAfter: {
						resolve: ({ base }) => ({ depAfter: base + '-after' }),
						base: true
					}
				})
				.get('/before', ({ depBefore, base }) => ({ depBefore, base }), {
					depBefore: true
				})
				.get('/after', ({ depAfter, base }) => ({ depAfter, base }), {
					depAfter: true
				})

			const resBefore = await app.handle(req('/before')).then((x) => x.json())
			const resAfter = await app.handle(req('/after')).then((x) => x.json())

			expect(resBefore).toEqual({ base: 'base-value', depBefore: 'base-value-before' })
			expect(resAfter).toEqual({ base: 'base-value', depAfter: 'base-value-after' })
		})

		it('async resolve in dependency chain', async () => {
			const app = new Elysia()
				.macro({
					slow: {
						resolve: async () => {
							await new Promise((r) => setTimeout(r, 10))
							return { slow: 'slow-value' }
						}
					},
					fast: {
						slow: true,
						resolve: ({ slow }) => ({ fast: slow + '-fast' })
					}
				})
				.get('/', ({ slow, fast }) => ({ slow, fast }), {
					fast: true
				})

			const response = await app.handle(req('/')).then((x) => x.json())

			expect(response).toEqual({
				slow: 'slow-value',
				fast: 'slow-value-fast'
			})
		})

		it('deduplication preserved with shared dependencies', async () => {
			let baseCallCount = 0

			const app = new Elysia()
				.macro({
					base: {
						resolve: () => {
							baseCallCount++
							return { base: 'base-value' }
						}
					},
					ext1: {
						base: true,
						resolve: ({ base }) => ({ ext1: base + '-ext1' })
					},
					ext2: {
						base: true,
						resolve: ({ base }) => ({ ext2: base + '-ext2' })
					}
				})
				.get('/', ({ base, ext1, ext2 }) => ({ base, ext1, ext2 }), {
					ext1: true,
					ext2: true
				})

			const response = await app.handle(req('/')).then((x) => x.json())

			expect(response).toEqual({
				base: 'base-value',
				ext1: 'base-value-ext1',
				ext2: 'base-value-ext2'
			})
		})

		it('guard with dependent macros', async () => {
			const sessionsPlugin = new Elysia().macro({
				sessions: {
					resolve: () => ({
						sessions: { get: () => 'guard-session' }
					})
				}
			})

			const app = new Elysia()
				.use(sessionsPlugin)
				.macro({
					auth: {
						sessions: true,
						resolve: ({ sessions }) => ({
							auth: { user: sessions.get() }
						})
					}
				})
				.guard({ auth: true }, (app) =>
					app.get('/', ({ auth }) => auth)
				)

			const response = await app.handle(req('/')).then((x) => x.json())

			expect(response).toEqual({ user: 'guard-session' })
		})

		it('group with dependent macros', async () => {
			const sessionsPlugin = new Elysia().macro({
				sessions: {
					resolve: () => ({
						sessions: { get: () => 'group-session' }
					})
				}
			})

			const app = new Elysia()
				.use(sessionsPlugin)
				.macro({
					auth: {
						sessions: true,
						resolve: ({ sessions }) => ({
							auth: { user: sessions.get() }
						})
					}
				})
				.group('/api', { auth: true }, (app) =>
					app.get('/', ({ auth }) => auth)
				)

			const response = await app.handle(req('/api/')).then((x) => x.json())

			expect(response).toEqual({ user: 'group-session' })
		})
	})
})
