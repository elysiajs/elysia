/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import Elysia, { error } from '../../src'
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

	it('appends onResponse', async () => {
		const app = new Elysia()
			.macro(({ onResponse }) => ({
				hi(fn: () => any) {
					onResponse(fn)
				}
			}))
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.onResponse?.length).toEqual(1)
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

		console.log(called)
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
})
