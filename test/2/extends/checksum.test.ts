/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../../src'
import { req } from '../../utils'
import type { MaybeArray } from '../../../src/types'

const length = (a: MaybeArray<Function> | undefined) =>
	Array.isArray(a) ? a.length : a ? 1 : 0

describe('Checksum', () => {
	it('deduplicate plugin', async () => {
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

	it('Set default checksum if not provided when name is set', async () => {
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

	it('Accept plugin when on different different', async () => {
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

	it('Deduplicate global hook on use', async () => {
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

	it('Filter inline hook', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).transform('global', () => {})

		const group = new Elysia().use(cookie()).get('/a', () => 'Hi', {
			transform() {}
		})

		const app = new Elysia()
			.use(cookie())
			.use(group)
			.get('/cookie', () => 'Hi')

		const [a, b] = app.routes

		expect(
			Math.abs(length(a.hooks.transform) - length(b.hooks.transform))
		).toBe(1)
	})

	it('Merge global hook', async () => {
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

	it('Run global hook from anonymous child once per request', async () => {
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

	// it('Deduplicate guard hook', async () => {
	// 	const guard = new Elysia({ prefix: '/guard' }).guard(
	// 		{
	// 			params: t.Object({ id: t.Number() }),
	// 			transform({ params }) {
	// 				const id = +params.id
	// 				if (!Number.isNaN(id)) params.id = id
	// 			}
	// 		},
	// 		(app) => app.get('/id/:id', ({ params: { id } }) => id)
	// 	)

	// 	const app = new Elysia().use(guard)
	// 	const res = await app.handle(req('/guard/id/123'))

	// 	expect(res.status).toBe(200)
	// })

	it('deduplicate in new instance', async () => {
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

	// it('Filter global event', async () => {
	// 	let x = 0
	// 	let a = 0
	// 	let b = 0

	// 	const plugin = new Elysia()
	// 		.onBeforeHandle('global', () => {
	// 			x++
	// 		})
	// 		.group('/v1', (app) =>
	// 			app
	// 				.onBeforeHandle(() => {
	// 					a++
	// 				})
	// 				.get('', () => 'A')
	// 				.group('/v1', (app) =>
	// 					app
	// 						.onBeforeHandle(() => {
	// 							b++
	// 						})
	// 						.get('/', () => 'B')
	// 				)
	// 		)

	// 	const app = new Elysia().use(plugin).get('/', () => 'A')

	// 	await Promise.all(
	// 		['/v1', '/v1/v1', '/'].map((path) => app.handle(req(path)))
	// 	)

	// 	expect(x).toBe(3)
	// 	expect(a).toBe(2)
	// 	expect(b).toBe(1)
	// })

	it('invalidate non-root lifecycle', async () => {
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

	it('read lifecylce top-down', async () => {
		let i = 0

		const plugin = new Elysia()
			.use(new Elysia({ prefix: '/not-call' }).get('/', () => 'asdf'))
			.use(
				new Elysia({ prefix: '/call' })
					.derive('global', () => {
						i++ // <-- should not be called, when requesting /asdf
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

	it('scope plugin', async () => {
		let i = 0

		const plugin = new Elysia().use(
			new Elysia({ prefix: '/call' })
				.derive(() => {
					i++ // <-- should not be called, when requesting /asdf
					return { test: 'test' }
				})
				.get('/', ({ test }) => test)
				.use(new Elysia({ prefix: '/not-call' }).get('/', () => 'asdf'))
		)

		const app = new Elysia().use(plugin)

		await Promise.all(
			['/not-call', '/call'].map((path) => app.handle(req(path)))
		)

		expect(i).toBe(1)
	})

	// Same invariant as "read lifecylce top-down" but the two siblings
	// are .use()'d directly on the compile root (no wrapping plugin).
	// Catches regressions where the rootHook lookup is correct only when
	// an extra plugin layer absorbs the propagated hooks first.
	it('sibling top-down on root without wrapping plugin', async () => {
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

	// Verifies the absorption-time stamping accumulates across levels in
	// the right order. grandparent's d1 must run before child's d2 must
	// run before grandchild's d3 (deepest registers earliest in route's
	// own appHook; outer levels prepend via reverse-merge).
	it('multi-level global derive order across grandparent/child/grandchild', async () => {
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

	// Path 3 of #use mirroring: parent has no hooks of its own, but the
	// absorbed child has stamped `inheritedChain` slots from its own
	// prior `.use()`. The mirror takes the share-by-ref branch
	// (`inheritedChain === childChain` → push original tuple). Locks in
	// that the inherited chain isn't dropped when parent's preChain is
	// undefined — without this, a regression that always clones (or
	// always discards) would silently corrupt the chain on plain
	// pass-through wrappers.
	it('absorb stamped child into parent without hooks (share-by-ref)', async () => {
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

		// `app` has zero hooks of its own — preChain is undefined when
		// it absorbs `mid`, hitting the share-by-ref branch for /r.
		const app = new Elysia().use(mid)

		await app.handle(req('/r'))

		expect(order).toEqual(['mid', 'sub'])
	})

	// Stricter version of the above: multiple hooks per level. Catches
	// regressions in the stamping merge — specifically, the b.concat(a) /
	// a.push(...b) branches in mergeArray where ordering can flip if the
	// merge args (or `reverse` flag) get swapped wrong.
	it('multi-fn cumulative inheritance preserves intra-level and cross-level order', async () => {
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

	it('handle reference parent-child', async () => {
		const parent = new Elysia({ name: 'parent' }).derive(
			'global',
			() => ({
				bye: () => 'bye'
			})
		)

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

	it('deduplicate local handler from global event', () => {
		const ip = new Elysia({ name: 'ip', seed: 'ip' })
			.derive('global', ({ server, request }) => {
				return {
					ip: server?.requestIP(request)
				}
			})
			.onBeforeHandle(() => {
				console.log('11')
			})
			.get('/ip', ({ ip }) => ip)

		const router1 = new Elysia({ name: 'ip1', seed: 'ip1' })
			.use(ip)
			.get('/ip-1', ({ ip }) => ip)

		const router2 = new Elysia({ name: 'ip2', seed: 'ip2' })
			.use(ip)
			.get('/ip-2', ({ ip }) => ip)

		const router3 = new Elysia({ name: 'ip2', seed: 'ip2' })
			.use(ip)
			.get('/ip-3', ({ ip }) => ip)

		const server = new Elysia({ name: 'server' }).use(router1).use(router2)

		expect(
			length(server.routes.find((x) => x.path === '/ip')?.hooks.beforeHandle)
		).toBe(2)
	})
})
