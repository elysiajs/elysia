import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('map resolve', () => {
	it('work', async () => {
		const app = new Elysia()
			.resolve(() => ({
				hi: () => 'hi'
			}))
			.mapResolve((resolvers) => ({
				...resolvers,
				hi2: () => 'hi'
			}))
			.get('/', ({ hi }) => hi())
			.get('/h2', ({ hi2 }) => hi2())

		const res = await app.handle(req('/')).then((t) => t.text())
		const res2 = await app.handle(req('/h2')).then((t) => t.text())

		expect(res).toBe('hi')
		expect(res2).toBe('hi')
	})

	it('inherits plugin', async () => {
		const plugin = new Elysia()
			.resolve({ as: 'global' }, () => ({
				hi: () => 'hi'
			}))
			// .mapResolve((resolvers) => ({
			// 	...resolvers,
			// 	hi2: () => 'hi'
			// }))
			// .get('/h2', ({ hi2 }) => hi2())

		const app = new Elysia().use(plugin).get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((t) => t.text())
		// const res2 = await app.handle(req('/h2')).then((t) => t.text())

		expect(res).toBe('hi')
		// expect(res2).toBe('hi')
	})

	it('not inherits plugin', async () => {
		const plugin = new Elysia()
			.resolve(() => ({
				hi: () => 'hi'
			}))
			.mapResolve((resolvers) => ({
				...resolvers,
				hi2: () => 'hi'
			}))
			.get('/h2', ({ hi2 }) => hi2())

		const app = new Elysia()
			.use(plugin)
			// @ts-expect-error
			.get('/', ({ hi2 }) => typeof hi2 === "undefined")

		const res = await app.handle(req('/')).then((t) => t.text())
		const res2 = await app.handle(req('/h2')).then((t) => t.text())

		expect(res).toBe('true')
		expect(res2).toBe('hi')
	})

	it('map resolve in order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.mapResolve(() => {
				order.push('A')
				return {}
			})
			.mapResolve(() => {
				order.push('B')
				return {}
			})
			.get('/', () => '')

		await app.handle(req('/'))

		expect(order).toEqual(['A', 'B'])
	})

	it('can mutate store', async () => {
		const app = new Elysia()
			.state('counter', 1)
			.mapResolve(({ store }) => ({
				increase: () => store.counter++
			}))
			.get('/', ({ store, increase }) => {
				increase()

				return store.counter
			})

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('2')
	})

	it('resolve with static analysis', async () => {
		const app = new Elysia()
			.mapResolve(({ headers: { name } }) => ({
				name
			}))
			.get('/', ({ name }) => name)

		const res = await app
			.handle(
				new Request('http://localhost/', {
					headers: {
						name: 'Elysia'
					}
				})
			)
			.then((t) => t.text())

		expect(res).toBe('Elysia')
	})

	it('store in the same stack as before handle', async () => {
		const stack: number[] = []

		const app = new Elysia()
			.onBeforeHandle(() => {
				stack.push(1)
			})
			.mapResolve(() => {
				stack.push(2)

				return { name: 'Ina' }
			})
			.get('/', ({ name }) => name, {
				beforeHandle() {
					stack.push(3)
				}
			})

		await app.handle(
			new Request('http://localhost/', {
				headers: {
					name: 'Elysia'
				}
			})
		)

		expect(stack).toEqual([1, 2, 3])
	})

	it('as global', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.mapResolve({ as: 'global' }, ({ path }) => {
				called.push(path)

				return {}
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		const res = await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('as local', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.mapResolve({ as: 'local' }, ({ path }) => {
				called.push(path)

				return {}
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		const res = await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner'])
	})
})
