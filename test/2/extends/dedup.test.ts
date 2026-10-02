import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../../src'

describe('plugin deduplication', () => {
	it('deduplicates a named plain plugin per root without cross-root state', async () => {
		const plugin = new Elysia({ name: 'plain-dedup' }).get(
			'/plain-dedup',
			() => 'ok'
		)
		const first = new Elysia().use(plugin).use(plugin)
		const second = new Elysia().use(plugin).use(plugin)

		expect(
			first.history.filter((route) => route.path === '/plain-dedup')
		).toHaveLength(1)
		expect(
			second.history.filter((route) => route.path === '/plain-dedup')
		).toHaveLength(1)
		await expect((await first.handle('/plain-dedup')).text()).resolves.toBe(
			'ok'
		)
		await expect(
			(await second.handle('/plain-dedup')).text()
		).resolves.toBe('ok')
	})

	it('does not duplicate a sub-plugin shared by sibling plugins', async () => {
		const order: number[] = []

		const shared = new Elysia({
			as: 'global',
			name: 'shared'
		}).beforeHandle(() => {
			order.push(3)
		})

		const left = new Elysia({ as: 'global', name: 'left' })
			.beforeHandle(() => {
				order.push(1)
			})
			.use(shared)

		const right = new Elysia({ as: 'global', name: 'right' })
			.beforeHandle(() => {
				order.push(2)
			})
			.use(shared)

		const app = new Elysia()
			.use(left)
			.use(right)
			.get('/', () => 'k')

		await app.handle('/')

		expect(order).toEqual([1, 3, 2])
	})

	it('deduplicates separate instances with the same name and seed', async () => {
		let count = 0
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				as: 'global',
				name: '@elysiajs/cookie',
				seed: options
			}).beforeHandle(() => {
				count++
			})

		const app = new Elysia()
			.use(cookie())
			.use(cookie())
			.use(cookie())
			.get('/', () => 'ok')

		await app.handle('/')

		expect(count).toBe(1)
	})

	it('different seeds produce distinct plugins', async () => {
		let count = 0
		const cookie = (variant: string) =>
			new Elysia({
				as: 'global',
				name: '@elysiajs/cookie',
				seed: variant
			}).beforeHandle(() => {
				count++
			})

		const app = new Elysia()
			.use(cookie('a'))
			.use(cookie('b'))
			.get('/', () => 'ok')

		await app.handle('/')

		expect(count).toBe(2)
	})

	it('deduplicates a shared plugin through three nesting levels', async () => {
		const order: number[] = []

		const leaf = new Elysia({ as: 'global', name: 'leaf' }).beforeHandle(
			() => {
				order.push(4)
			}
		)

		const mid1 = new Elysia({ as: 'global', name: 'mid1' })
			.beforeHandle(() => {
				order.push(3)
			})
			.use(leaf)

		const mid2 = new Elysia({ as: 'global', name: 'mid2' })
			.beforeHandle(() => {
				order.push(5)
			})
			.use(leaf)

		const top1 = new Elysia({ as: 'global', name: 'top1' })
			.beforeHandle(() => {
				order.push(1)
			})
			.use(mid1)

		const top2 = new Elysia({ as: 'global', name: 'top2' })
			.beforeHandle(() => {
				order.push(2)
			})
			.use(mid2)

		const app = new Elysia()
			.use(top1)
			.use(top2)
			.get('/', () => 'k')

		await app.handle('/')

		expect(order).toEqual([1, 3, 4, 2, 5])
	})

	it('plugin-scoped hook stops propagating after one level', async () => {
		const order: string[] = []

		const inner = new Elysia({ name: 'inner' }).beforeHandle(
			'plugin',
			function innerFn() {
				order.push('inner')
			}
		)

		const outer = new Elysia({ name: 'outer' })
			.beforeHandle('plugin', function outerFn() {
				order.push('outer')
			})
			.use(inner)

		const app = new Elysia().use(outer).get('/', () => 'k')

		await app.handle('/')

		expect(order).toEqual(['outer'])
	})

	it('global-scoped hooks propagate to root regardless of depth', async () => {
		const order: string[] = []

		const inner = new Elysia({ as: 'global', name: 'inner' }).beforeHandle(
			() => {
				order.push('inner')
			}
		)

		const outer = new Elysia({ as: 'global', name: 'outer' })
			.beforeHandle(() => {
				order.push('outer')
			})
			.use(inner)

		const app = new Elysia().use(outer).get('/', () => 'k')

		await app.handle('/')

		expect(order).toEqual(['outer', 'inner'])
	})

	it('derive runs once when its plugin is shared by siblings', async () => {
		let count = 0

		const auth = new Elysia({ name: 'auth' }).derive('global', () => {
			count++
			return { user: 'alice' }
		})

		const a = new Elysia({ name: 'a' }).use(auth)
		const b = new Elysia({ name: 'b' }).use(auth)

		const app = new Elysia()
			.use(a)
			.use(b)
			.get('/', ({ user }: any) => user)

		const res = await app.handle('/').then((r) => r.text())

		expect(res).toBe('alice')
		expect(count).toBe(1)
	})

	it('routes registered before .use(plugin) do not pick up its hooks', async () => {
		const order: string[] = []

		const plugin = new Elysia({
			as: 'global',
			name: 'late'
		}).beforeHandle(() => {
			order.push('late')
		})

		const app = new Elysia()
			.get('/early', () => 'a')
			.use(plugin)
			.get('/after', () => 'b')

		order.length = 0
		await app.handle('/early')
		expect(order).toEqual([])

		order.length = 0
		await app.handle('/after')
		expect(order).toEqual(['late'])
	})

	it('runs an unnamed shared plugin once for each parent', async () => {
		const order: number[] = []

		const shared = new Elysia({ as: 'global' }).beforeHandle(() => {
			order.push(3)
		})

		const left = new Elysia({ as: 'global', name: 'left' })
			.beforeHandle(() => {
				order.push(1)
			})
			.use(shared)

		const right = new Elysia({ as: 'global', name: 'right' })
			.beforeHandle(() => {
				order.push(2)
			})
			.use(shared)

		const app = new Elysia()
			.use(left)
			.use(right)
			.get('/', () => 'k')

		await app.handle('/')

		expect(order).toEqual([1, 3, 2, 3])
	})

	it('runs every anonymous plugin instance', async () => {
		const order: number[] = []

		const a = new Elysia({ as: 'global' }).beforeHandle(() => {
			order.push(1)
		})
		const b = new Elysia({ as: 'global' }).beforeHandle(() => {
			order.push(2)
		})

		const app = new Elysia()
			.use(a)
			.use(b)
			.get('/', () => 'k')

		await app.handle('/')

		expect(order).toEqual([1, 2])
	})

	it("uses each parent's hook context when a plugin is shared", async () => {
		const order: string[] = []

		const sub = new Elysia({ prefix: '/sub' }).get('/r', () => 'ok')

		const parentA = new Elysia()
			.derive('global', () => {
				order.push('A')
				return {}
			})
			.use(sub)

		const parentB = new Elysia()
			.derive('global', () => {
				order.push('B')
				return {}
			})
			.use(sub)

		order.length = 0
		await parentA.handle('/sub/r')
		expect(order).toEqual(['A'])

		order.length = 0
		await parentB.handle('/sub/r')
		expect(order).toEqual(['B'])
	})

	it('scopes hooks correctly across mixed direct and absorbed routes', async () => {
		let count = 0

		const plug = new Elysia({ prefix: '/p' })
			.derive('global', () => {
				count++
				return {}
			})
			.get('/x', () => 'ok')

		const app = new Elysia()
			.get('/before', () => 'before')
			.use(plug)
			.get('/after', () => 'after')

		count = 0
		await app.handle('/before')
		expect(count).toBe(0)

		count = 0
		await app.handle('/p/x')
		expect(count).toBe(1)

		count = 0
		await app.handle('/after')
		expect(count).toBe(1)
	})
})
