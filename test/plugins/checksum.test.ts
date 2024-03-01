import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Checksum', () => {
	it('deduplicate plugin', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).onTransform({ as: 'global' }, () => {})

		const group = new Elysia().use(cookie({})).get('/a', () => 'Hi')

		const app = new Elysia()
			.use(cookie({}))
			.use(group)
			.get('/cookie', () => 'Hi')

		const [a, b] = app.router.history

		expect(a.hooks.transform!.length).toBe(1)
		expect(b.hooks.transform!.length).toBe(1)
	})

	it('Set default checksum if not provided when name is set', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).onTransform({ as: 'global' }, () => {})

		const group = new Elysia().use(cookie()).get('/a', () => 'Hi')

		const app = new Elysia()
			.use(cookie())
			.use(group)
			.get('/cookie', () => 'Hi')

		const [a, b] = app.router.history

		expect(a.hooks.transform!.length).toBe(1)
		expect(b.hooks.transform!.length).toBe(1)
	})

	it('Accept plugin when on different different', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).onTransform({ as: 'global' }, () => {})

		const group = new Elysia().use(cookie({})).get('/a', () => 'Hi')

		const app = new Elysia()
			.use(group)
			.use(
				cookie({
					hello: 'world'
				})
			)
			.get('/cookie', () => 'Hi')

		const [a, b] = app.router.history

		expect(
			Math.abs(a.hooks.transform!.length - b.hooks.transform!.length)
		).toBe(1)
	})

	it('Deduplicate global hook on use', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).onTransform({ as: 'global' }, () => {})

		const group = new Elysia().use(cookie()).get('/a', () => 'Hi')

		const app = new Elysia()
			.use(cookie())
			.use(group)
			.get('/cookie', () => 'Hi')

		const [a, b] = app.router.history

		expect(
			Math.abs(a.hooks.transform!.length - b.hooks.transform!.length)
		).toBe(0)
	})

	it('Filter inline hook', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).onTransform({ as: 'global' }, () => {})

		const group = new Elysia().use(cookie()).get('/a', () => 'Hi', {
			transform() {}
		})

		const app = new Elysia()
			.use(cookie())
			.use(group)
			.get('/cookie', () => 'Hi')

		const [a, b] = app.router.history

		expect(
			Math.abs(a.hooks.transform!.length - b.hooks.transform!.length)
		).toBe(1)
	})

	it('Merge global hook', async () => {
		let count = 0

		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).onTransform({ as: 'global' }, () => {})

		const group = new Elysia()
			.use(cookie())
			.onTransform({ as: 'global' }, () => {
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

	it('Deduplicate guard hook', async () => {
		const guard = new Elysia({ prefix: '/guard' }).guard(
			{
				params: t.Object({ id: t.Number() }),
				transform({ params }) {
					const id = +params.id
					if (!Number.isNaN(id)) params.id = id
				}
			},
			(app) => app.get('/id/:id', ({ params: { id } }) => id)
		)

		const app = new Elysia().use(guard)
		const res = await app.handle(req('/guard/id/123'))

		expect(res.status).toBe(200)
	})

	it('deduplicate in new instance', async () => {
		const cookie = (options?: Record<string, unknown>) =>
			new Elysia({
				name: '@elysiajs/cookie',
				seed: options
			}).derive({ as: 'global' }, () => {
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

	it('Filter global event', async () => {
		let x = 0
		let a = 0
		let b = 0

		const plugin = new Elysia()
			.onBeforeHandle({ as: 'global' }, () => {
				x++
			})
			.group('/v1', (app) =>
				app
					.onBeforeHandle(() => {
						a++
					})
					.get('', () => 'A')
					.group('/v1', (app) =>
						app
							.onBeforeHandle(() => {
								b++
							})
							.get('/', () => 'B')
					)
			)

		const app = new Elysia().use(plugin).get('/', () => 'A')

		await Promise.all(
			['/v1', '/v1/v1', '/'].map((path) => app.handle(req(path)))
		)

		expect(x).toBe(3)
		expect(a).toBe(2)
		expect(b).toBe(1)
	})

	it('invalidate non-root lifecycle', async () => {
		let a = 0
		let b = 0
		let c = 0

		const plugin = new Elysia()
			.use(
				new Elysia()
					.derive({ as: 'global' }, () => {
						a++

						return {}
					})
					.get('/1', () => 'asdf')
			)
			.use(
				new Elysia()
					.derive({ as: 'global' }, () => {
						b++

						return { test: 'test' }
					})
					.get('/2', ({ test }) => test)
					.use(
						new Elysia()
							.derive({ as: 'global' }, () => {
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
			['/root', '/1', '/2', '/3', '/all'].map((path) =>
				app.handle(req(path))
			)
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
					.derive({ as: 'global' }, () => {
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
			new Elysia({ prefix: '/call', scoped: true })
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

	it('handle reference parent-child', async () => {
		const parent = new Elysia({ name: 'parent' }).derive({ as: 'global' }, () => ({
			bye: () => 'bye'
		}))

		const child = new Elysia({ name: 'child' })
			.use(parent)
			.derive({ as: 'global' }, ({ bye }) => ({
				hi: () => `hi + ${bye()}`
			}))

		const app = new Elysia()
			.use(parent)
			.use(child)
			.get('/', ({ hi }) => hi())

		const response = await app.handle(req('/')).then((res) => res.text())

		expect(response).toBe('hi + bye')
	})
})
