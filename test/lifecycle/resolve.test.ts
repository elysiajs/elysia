import { Elysia, error } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('resolve', () => {
	it('work', async () => {
		const app = new Elysia()
			.resolve(() => ({
				hi: () => 'hi'
			}))
			.get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')
	})

	it('inherits plugin', async () => {
		const plugin = new Elysia().resolve({ as: 'global' }, () => ({
			hi: () => 'hi'
		}))

		const app = new Elysia().use(plugin).get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')
	})

	it('not inherits plugin on local', async () => {
		const plugin = new Elysia().resolve(() => ({
			hi: () => 'hi'
		}))

		const app = new Elysia()
			.use(plugin)
			// @ts-expect-error
			.get('/', ({ hi }) => typeof hi === 'undefined')

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('true')
	})

	it('can mutate store', async () => {
		const app = new Elysia()
			.state('counter', 1)
			.resolve(({ store }) => ({
				increase: () => store.counter++
			}))
			.get('/', ({ store, increase }) => {
				increase()

				return store.counter
			})

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('2')
	})

	it('derive with static analysis', async () => {
		const app = new Elysia()
			.resolve(({ headers: { name } }) => ({
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
			.resolve(() => {
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

	it('resolve in order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.resolve(() => {
				order.push('A')
				return {}
			})
			.resolve(() => {
				order.push('B')
				return {}
			})
			.get('/', () => '')

		await app.handle(req('/'))

		expect(order).toEqual(['A', 'B'])
	})

	it('as global', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.resolve({ as: 'global' }, ({ path }) => {
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

	it('as scoped', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.resolve({ as: 'scoped' }, ({ path }) => {
				called.push(path)

				return {}
			})
			.get('/inner', () => 'NOOP')

		const middle = new Elysia().use(plugin).get('/middle', () => 'NOOP')

		const app = new Elysia().use(middle).get('/outer', () => 'NOOP')

		const res = await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/middle')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner', '/middle'])
	})

	it('as local', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.resolve({ as: 'local' }, ({ path }) => {
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

	it('support array', async () => {
		let total = 0

		const app = new Elysia()
			.onAfterHandle([
				() => {
					total++
				},
				() => {
					total++
				}
			])
			.get('/', () => 'NOOP')

		const res = await app.handle(req('/'))

		expect(total).toEqual(2)
	})

	it('handle error', async () => {
		const route = new Elysia()
			.resolve(() => {
				return error(418)
			})
			.get('/', () => '')

		const res = await new Elysia({ aot: true }).use(route).handle(req('/'))
		expect(await res.status).toEqual(418)
		expect(await res.text()).toEqual("I'm a teapot")

		const res2 = await new Elysia({ aot: false })
			.use(route)
			.handle(req('/'))
		expect(await res2.status).toEqual(418)
		expect(await res2.text()).toEqual("I'm a teapot")
	})

	/** These work but there's no support for type
	it('work inline', async () => {
		const app = new Elysia().get('/', ({ hi }) => hi(), {
			resolve: () => ({
				hi: () => 'hi'
			})
		})

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')
	})

	it('work inline array', async () => {
		const app = new Elysia().get(
			'/',
			({ first, last }) => [last, first].join(' '),
			{
				resolve: [
					() => ({
						first: 'himari'
					}),
					() => ({ last: 'akeboshi' })
				]
			}
		)

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('akeboshi himari')
	})

	it('work group guard', async () => {
		const app = new Elysia()
			.guard(
				{
					resolve: () => ({ hi: () => 'hi' })
				},
				(app) => app.get('/', ({ hi }) => hi())
			)
			// @ts-expect-error
			.get('/nope', ({ hi }) => hi?.() ?? 'nope')

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')

		const nope = await app.handle(req('/nope')).then((t) => t.text())
		expect(nope).toBe('nope')
	})

	it('work group array guard', async () => {
		const app = new Elysia()
			.guard(
				{
					resolve: [
						() => ({ first: 'himari' }),
						() => ({ last: 'akeboshi' })
					]
				},
				(app) =>
					app.get('/', ({ first, last }) => [last, first].join(' '))
			)
			// @ts-expect-error
			.get('/nope', ({ first, last }) => [last, first].join(''))

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('akeboshi himari')

		const nope = await app.handle(req('/nope')).then((t) => t.text())
		expect(nope).toBe('')
	})

	it('work local guard', async () => {
		const app = new Elysia()
			.guard({
				resolve: () => ({ hi: () => 'hi' })
			})
			.get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')
	})

	it('work local array guard', async () => {
		const app = new Elysia()
			.guard({
				resolve: [
					() => ({
						first: 'himari'
					}),
					() => ({ last: 'akeboshi' })
				]
			})
			.get('/', ({ first, last }) => [last, first].join(' '))

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('akeboshi himari')
	})

	it('work scoped guard', async () => {
		const plugin = new Elysia().guard({
			as: 'scoped',
			resolve: () => ({ hi: () => 'hi' })
		})

		const app = new Elysia().use(plugin).get('/', ({ hi }) => hi())

		const root = new Elysia()
			.use(app)
			// @ts-expect-error
			.get('/root', ({ hi }) => hi?.() ?? 'nope')

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')

		const res2 = await root.handle(req('/root')).then((t) => t.text())
		expect(res2).toBe('nope')
	})

	it('work global guard', async () => {
		const plugin = new Elysia().guard({
			as: 'global',
			resolve: () => ({ hi: () => 'hi' })
		})

		const app = new Elysia().use(plugin).get('/', ({ hi }) => hi())

		const root = new Elysia()
			.use(app)
			.get('/root', ({ hi }) => hi?.() ?? 'nope')

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')

		const res2 = await root.handle(req('/root')).then((t) => t.text())
		expect(res2).toBe('hi')
	})
	 */

	it('handle return resolve without throw', async () => {
		let isOnErrorCalled = false

		const app = new Elysia()
			.onError(() => {
				isOnErrorCalled = true
			})
			.resolve(({ status }) => status(418))
			.get('/', () => '')

		await app.handle(req('/'))

		expect(isOnErrorCalled).toBe(false)
	})
})
