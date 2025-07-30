/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import Elysia, { error, t } from '../../src'
import { req } from '../utils'

describe('Macro', () => {
	it('work', async () => {
		let answer: string | undefined

		const app = new Elysia()
			.macro(() => ({
				hi(config: string) {
					answer = config
				}
			}))
			.get('/', () => 'Hello World', {
				hi: 'Hello World'
			})

		await app.handle(req('/'))

		expect(answer).toBe('Hello World')
	})

	it('accept function', async () => {
		let answer: string | undefined

		const app = new Elysia()
			.macro(() => ({
				hi(fn: () => any) {
					fn()
				}
			}))
			.get('/', () => 'Hello World', {
				hi() {
					answer = 'Hello World'
				}
			})

		await app.handle(req('/'))

		expect(answer).toBe('Hello World')
	})

	it('create custom life-cycle', async () => {
		const app = new Elysia()
			.macro(({ onBeforeHandle }) => ({
				hi(fn: () => any) {
					onBeforeHandle(fn)
				}
			}))
			.get('/', () => 'Hello World', {
				hi: () => 'Hello World'
			})

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('Hello World')
	})

	it('insert after on local stack by default', async () => {
		const orders: number[] = []

		const app = new Elysia()
			.macro(({ onBeforeHandle }) => ({
				hi(fn: () => any) {
					onBeforeHandle(fn)
				}
			}))
			.onBeforeHandle(() => {
				orders.push(1)
			})
			.get('/', () => 'Hello World', {
				beforeHandle() {
					orders.push(2)
				},
				hi: () => {
					orders.push(3)
				}
			})

		await app.handle(req('/'))

		expect(orders).toEqual([1, 2, 3])
	})

	it('insert after on local stack', async () => {
		const orders: number[] = []

		const app = new Elysia()
			.macro(({ onBeforeHandle }) => ({
				hi(fn: () => any) {
					onBeforeHandle({ insert: 'after', stack: 'local' }, fn)
				}
			}))
			.onBeforeHandle(() => {
				orders.push(1)
			})
			.get('/', () => 'Hello World', {
				beforeHandle() {
					orders.push(2)
				},
				hi: () => {
					orders.push(3)
				}
			})

		await app.handle(req('/'))

		expect(orders).toEqual([1, 2, 3])
	})

	it('insert before on local stack', async () => {
		const orders: number[] = []

		const app = new Elysia()
			.macro(({ onBeforeHandle }) => ({
				hi(fn: () => any) {
					onBeforeHandle({ insert: 'before', stack: 'local' }, fn)
				}
			}))
			.onBeforeHandle(() => {
				orders.push(1)
			})
			.get('/', () => 'Hello World', {
				beforeHandle() {
					orders.push(3)
				},
				hi: () => {
					orders.push(2)
				}
			})

		await app.handle(req('/'))

		expect(orders).toEqual([1, 2, 3])
	})

	it('insert after on global stack', async () => {
		const orders: number[] = []

		const app = new Elysia()
			.macro(({ onBeforeHandle }) => ({
				hi(fn: () => any) {
					onBeforeHandle({ insert: 'after', stack: 'global' }, fn)
				}
			}))
			.onBeforeHandle(() => {
				orders.push(1)
			})
			.get('/', () => 'Hello World', {
				beforeHandle() {
					orders.push(3)
				},
				hi: () => {
					orders.push(2)
				}
			})

		await app.handle(req('/'))

		expect(orders).toEqual([1, 2, 3])
	})

	it('insert before on global stack', async () => {
		const orders: number[] = []

		const app = new Elysia()
			.macro(({ onBeforeHandle }) => ({
				hi(fn: () => any) {
					onBeforeHandle({ insert: 'before', stack: 'global' }, fn)
				}
			}))
			.onBeforeHandle(() => {
				orders.push(2)
			})
			.get('/', () => 'Hello World', {
				beforeHandle() {
					orders.push(3)
				},
				hi: () => {
					orders.push(1)
				}
			})

		await app.handle(req('/'))

		expect(orders).toEqual([1, 2, 3])
	})

	it('appends onParse', async () => {
		const app = new Elysia()
			.macro(({ onParse }) => ({
				hi(fn: () => any) {
					onParse(fn)
				}
			}))
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.parse?.length).toEqual(1)
	})

	it('appends onTransform', async () => {
		const app = new Elysia()
			.macro(({ onTransform }) => ({
				hi(fn: () => any) {
					onTransform(fn)
				}
			}))
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.transform?.length).toEqual(1)
	})

	it('appends onBeforeHandle', async () => {
		const app = new Elysia()
			.macro(({ onBeforeHandle }) => ({
				hi(fn: () => any) {
					onBeforeHandle(fn)
				}
			}))
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.beforeHandle?.length).toEqual(1)
	})

	it('appends onAfterHandle', async () => {
		const app = new Elysia()
			.macro(({ onAfterHandle }) => ({
				hi(fn: () => any) {
					onAfterHandle(fn)
				}
			}))
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.afterHandle?.length).toEqual(1)
	})

	it('appends onError', async () => {
		const app = new Elysia()
			.macro(({ onError }) => ({
				hi(fn: () => any) {
					onError(fn)
				}
			}))
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.error?.length).toEqual(1)
	})

	it('appends onAfterResponse', async () => {
		const app = new Elysia()
			.macro(({ onAfterResponse }) => ({
				hi(fn: () => any) {
					onAfterResponse(fn)
				}
			}))
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.afterResponse?.length).toEqual(1)
	})

	it('handle deduplication', async () => {
		let call = 0

		const a = new Elysia({ name: 'a', seed: 'awdawd' }).macro(
			({ onBeforeHandle }) => ({
				a(_: string) {
					onBeforeHandle(() => {
						call++
					})
				}
			})
		)

		const b = new Elysia({ name: 'b', seed: 'add' })
			.use(a)
			.decorate('b', 'b')

		const app = new Elysia()
			.use(a)
			.use(b)
			.get('/', () => 'Hello World', {
				a: 'a'
			})

		await app.handle(req('/'))

		expect(call).toBe(1)
	})

	it('propagation macro without inaccurate deduplication in guard', async () => {
		let call = 0

		const base = new Elysia({ name: 'base' }).macro(
			({ onBeforeHandle }) => ({
				auth: (role: 'teacher' | 'student' | 'admin' | 'noLogin') => {
					onBeforeHandle(() => {
						call++
					})
				}
			})
		)

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

		const plugin = new Elysia().macro(() => ({
			hi(config: string) {
				called++
			}
		}))

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

	it('handle nested macro', async () => {
		const authGuard = new Elysia().macro(({ onBeforeHandle }) => ({
			requiredUser(value: boolean) {
				onBeforeHandle(async () => {
					if (value)
						return error(401, {
							code: 'S000002',
							message: 'Unauthorized'
						})
				})
			}
		}))

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
			.macro(({ onBeforeHandle }) => ({
				count(_: boolean) {
					onBeforeHandle((ctx) => {
						called++
					})
				}
			}))
			.get('/', () => 'hi', {
				count: true
			})

		const app = new Elysia().use(plugin).get('/foo', () => 'foo', {
			count: true
		})

		await app.handle(req('/'))
	})

	it('inherits macro in group', async () => {
		const authGuard = new Elysia().macro(({ onBeforeHandle }) => ({
			isAuth(shouldAuth: boolean) {
				if (shouldAuth) {
					onBeforeHandle(({ cookie: { session }, error }) => {
						if (!session.value) return error(418)
					})
				}
			}
		}))

		const app = new Elysia().use(authGuard).group('/posts', (app) =>
			app.get('/', () => 'a', {
				isAuth: true
			})
		)

		const status = await app.handle(req('/posts')).then((x) => x.status)

		expect(status).toBe(418)
	})

	it('inherits macro in guard', async () => {
		const authGuard = new Elysia().macro(({ onBeforeHandle }) => ({
			isAuth(shouldAuth: boolean) {
				if (shouldAuth) {
					onBeforeHandle(({ cookie: { session }, error }) => {
						if (!session.value) return error(418)
					})
				}
			}
		}))

		const app = new Elysia().use(authGuard).guard({}, (app) =>
			app.get('/posts', () => 'a', {
				isAuth: true
			})
		)

		const status = await app.handle(req('/posts')).then((x) => x.status)

		expect(status).toBe(418)
	})

	it('inherits macro in group', async () => {
		const authGuard = new Elysia().macro(({ onBeforeHandle }) => ({
			isAuth(shouldAuth: boolean) {
				if (shouldAuth) {
					onBeforeHandle(({ cookie: { session }, error }) => {
						if (!session.value) return error(418)
					})
				}
			}
		}))

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
			hello: 'nagisa'
		})

		new Elysia()
			.macro(() => {
				return {
					hello(a: string) {
						called.push(a)
					}
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

		const a = new Elysia({ name: 'a' }).macro(({ onBeforeHandle }) => {
			return {
				isSignIn() {
					registered++
					onBeforeHandle(() => {
						called++
					})
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
					resolve: ({ error }) => ({
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
					resolve: ({ error }) => ({
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
					resolve: ({ error }) => ({
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
					resolve: ({ error }) => ({
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
					resolve: ({ error }) => {
						if (Math.random() > 2) return error(401)

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
					resolve: async ({ error }) => {
						if (Math.random() > 2) return error(401)

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
				({ user, error }) => {
					if (!user) return error(401)

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
})
