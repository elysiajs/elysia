import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../../src'
import { req } from '../../utils'
import type { MaybeArray } from '../../../src/types'

const length = (a: MaybeArray<Function> | undefined) =>
	Array.isArray(a) ? a.length : a ? 1 : 0

describe('named plugin deduplication and hook inheritance', () => {
	it('deduplicates the same name and seed across nested uses', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).transform('global', () => {})

		const group = new Elysia().use(cookie({})).get('/a', () => 'Hi')

		const app = new Elysia()
			.use(cookie({}))
			.use(group)
			.get('/cookie', () => 'Hi')

		const [a, b] = app.routes

		expect(length(a.hooks.transform)).toBe(1)
		expect(length(b.hooks.transform)).toBe(1)
	})

	it('deduplicates a named plugin without an explicit seed', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).transform('global', () => {})

		const group = new Elysia().use(cookie()).get('/a', () => 'Hi')

		const app = new Elysia()
			.use(cookie())
			.use(group)
			.get('/cookie', () => 'Hi')

		const [a, b] = app.routes

		expect(length(a.hooks.transform)).toBe(1)
		expect(length(b.hooks.transform)).toBe(1)
	})

	it('keeps named plugins with different seeds distinct', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).transform('global', () => {})

		const group = new Elysia().use(cookie({})).get('/a', () => 'Hi')

		const app = new Elysia()
			.use(group)
			.use(
				cookie({
					hello: 'world'
				})
			)
			.get('/cookie', () => 'Hi')

		const [a, b] = app.routes

		expect(
			Math.abs(length(a.hooks.transform) - length(b.hooks.transform))
		).toBe(1)
	})

	it('does not duplicate a global hook from a reused named plugin', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).transform('global', () => {})

		const group = new Elysia().use(cookie()).get('/a', () => 'Hi')

		const app = new Elysia()
			.use(cookie())
			.use(group)
			.get('/cookie', () => 'Hi')

		const [a, b] = app.routes

		expect(
			Math.abs(length(a.hooks.transform) - length(b.hooks.transform))
		).toBe(0)
	})

	it('keeps an inline hook distinct from a deduplicated global hook', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).transform('global', () => {})

		const group = new Elysia().use(cookie()).get(
			'/a',
			{
				transform() {}
			},
			() => 'Hi'
		)

		const app = new Elysia()
			.use(cookie())
			.use(group)
			.get('/cookie', () => 'Hi')

		const [a, b] = app.routes

		expect(
			Math.abs(length(a.hooks.transform) - length(b.hooks.transform))
		).toBe(1)
	})

	it('merges a child global hook after deduplicating a shared plugin', async () => {
		let count = 0

		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).transform('global', () => {})

		const group = new Elysia()
			.use(cookie())
			.transform('global', () => {
				count++
			})
			.get('/a', () => 'Hi')

		const app = new Elysia()
			.use(cookie())
			.use(group)
			.get('/cookie', () => 'Hi')

		await Promise.all(['/a', '/cookie'].map((x) => app.handle(req(x))))

		expect(count).toBe(2)
	})

	it('runs an anonymous child global hook once per request', async () => {
		let count = 0

		const group = new Elysia()
			.transform('global', () => {
				count++
			})
			.get('/a', () => 'Hi')

		const app = new Elysia().use(group)

		await app.handle(req('/a'))
		expect(count).toBe(1)

		await app.handle(req('/a'))
		expect(count).toBe(2)
	})

	it('shares a global derive across separately prefixed plugins', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).derive('global', () => {
				return {
					cookie: 'mock'
				}
			})

		const plugin = new Elysia({ prefix: '/v1' })
			.use(cookie())
			.get('/plugin', ({ cookie }) => cookie)

		const plugin2 = new Elysia({ prefix: '/v2' })
			.use(cookie())
			.get('/plugin', ({ cookie }) => cookie)

		const app = new Elysia()
			.use(cookie())
			.use(plugin)
			.use(plugin2)
			.get('/root', ({ cookie }) => cookie)

		const res1 = await app.handle(req('/v1/plugin')).then((x) => x.text())
		expect(res1).toBe('mock')

		const res2 = await app.handle(req('/v1/plugin')).then((x) => x.text())
		expect(res2).toBe('mock')

		const root = await app.handle(req('/root')).then((x) => x.text())
		expect(root).toBe('mock')
	})

	it('applies nested global derives only to routes that inherit them', async () => {
		let a = 0
		let b = 0
		let c = 0

		const plugin = new Elysia()
			.use(
				new Elysia()
					.derive('global', () => {
						a++

						return {}
					})
					.get('/1', () => 'asdf')
			)
			.use(
				new Elysia()
					.derive('global', () => {
						b++

						return { test: 'test' }
					})
					.get('/2', ({ test }) => test)
					.use(
						new Elysia()
							.derive('global', () => {
								c++

								return { test: 'test' }
							})
							.get('/3', ({ test }) => test)
					)
			)

		const app = new Elysia()
			.get('/root', () => 'A')
			.use(plugin)
			.get('/all', () => 'A')

		await Promise.all(
			['/root', '/1', '/2', '/3', '/all'].map((path) => app.handle(path))
		)

		expect(a).toBe(4)
		expect(b).toBe(3)
		expect(c).toBe(2)
	})

	it('runs a nested global derive only for routes in its branch', async () => {
		let i = 0

		const plugin = new Elysia()
			.use(new Elysia({ prefix: '/not-call' }).get('/', () => 'asdf'))
			.use(
				new Elysia({ prefix: '/call' })
					.derive('global', () => {
						i++
						return { test: 'test' }
					})
					.get('/', ({ test }) => test)
			)

		const app = new Elysia().use(plugin)

		await Promise.all(
			['/not-call', '/call'].map((path) => app.handle(req(path)))
		)

		expect(i).toBe(1)
	})

	it("does not run a sibling's global derive on another root route", async () => {
		let i = 0

		const plugin1 = new Elysia({ prefix: '/not-call' }).get(
			'/',
			() => 'asdf'
		)
		const plugin2 = new Elysia({ prefix: '/call' })
			.derive('global', () => {
				i++
				return { test: 'test' }
			})
			.get('/', ({ test }) => test)

		const app = new Elysia().use(plugin1).use(plugin2)

		await Promise.all(
			['/not-call', '/call'].map((path) => app.handle(req(path)))
		)

		expect(i).toBe(1)
	})

	it('runs inherited global derives from outermost to innermost plugin', async () => {
		const order: string[] = []

		const grandchild = new Elysia()
			.derive('global', () => {
				order.push('gc')
				return {}
			})
			.get('/r', () => 'ok')

		const child = new Elysia()
			.derive('global', () => {
				order.push('c')
				return {}
			})
			.use(grandchild)

		const grandparent = new Elysia()
			.derive('global', () => {
				order.push('gp')
				return {}
			})
			.use(child)

		await grandparent.handle(req('/r'))

		expect(order).toEqual(['gp', 'c', 'gc'])
	})

	it('preserves inherited global derives through a parent without hooks', async () => {
		const order: string[] = []

		const sub = new Elysia()
			.derive('global', () => {
				order.push('sub')
				return {}
			})
			.get('/r', () => 'ok')

		const mid = new Elysia()
			.derive('global', () => {
				order.push('mid')
				return {}
			})
			.use(sub)

		const app = new Elysia().use(mid)

		await app.handle(req('/r'))

		expect(order).toEqual(['mid', 'sub'])
	})

	it('preserves registration order within and across nested plugins', async () => {
		const order: string[] = []

		const grandchild = new Elysia()
			.derive('global', () => {
				order.push('gc1')
				return {}
			})
			.derive('global', () => {
				order.push('gc2')
				return {}
			})
			.get('/r', () => 'ok')

		const child = new Elysia()
			.derive('global', () => {
				order.push('c1')
				return {}
			})
			.derive('global', () => {
				order.push('c2')
				return {}
			})
			.use(grandchild)

		const grandparent = new Elysia()
			.derive('global', () => {
				order.push('gp1')
				return {}
			})
			.derive('global', () => {
				order.push('gp2')
				return {}
			})
			.use(child)

		await grandparent.handle(req('/r'))

		expect(order).toEqual(['gp1', 'gp2', 'c1', 'c2', 'gc1', 'gc2'])
	})

	it('keeps parent-derived values available through a deduplicated child', async () => {
		const parent = new Elysia({ name: 'parent' }).derive('global', () => ({
			bye: () => 'bye'
		}))

		const child = new Elysia({ name: 'child' })
			.use(parent)
			.derive('global', ({ bye }) => ({
				hi: () => `hi + ${bye()}`
			}))

		const app = new Elysia()
			.use(parent)
			.use(child)
			.get('/', ({ hi }) => hi())

		const response = await app.handle(req('/')).then((res) => res.text())

		expect(response).toBe('hi + bye')
	})

	it('keeps local hooks from each parent when global events deduplicate', () => {
		const ip = new Elysia({ name: 'ip', seed: 'ip' })
			.derive('global', ({ server, request }) => {
				return {
					ip: server?.requestIP(request)
				}
			})
			.beforeHandle(() => {})
			.get('/ip', ({ ip }) => ip)

		const router1 = new Elysia({ name: 'ip1', seed: 'ip1' })
			.use(ip)
			.get('/ip-1', ({ ip }) => ip)

		const router2 = new Elysia({ name: 'ip2', seed: 'ip2' })
			.use(ip)
			.get('/ip-2', ({ ip }) => ip)

		const server = new Elysia({ name: 'server' }).use(router1).use(router2)

		expect(
			length(
				server.routes.find((x) => x.path === '/ip')?.hooks.beforeHandle
			)
		).toBe(2)
	})
})
