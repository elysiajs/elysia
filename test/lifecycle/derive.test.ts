import { Elysia, error } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('derive', () => {
	it('work', async () => {
		const app = new Elysia()
			.derive(() => ({
				hi: () => 'hi'
			}))
			.get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')
	})

	it('inherits plugin', async () => {
		const plugin = new Elysia().derive({ as: 'global' }, () => ({
			hi: () => 'hi'
		}))

		const app = new Elysia().use(plugin).get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')
	})

	it('inherits plugin on local', async () => {
		const plugin = new Elysia().derive(() => ({
			hi: () => 'hi'
		}))

		const app = new Elysia()
			.use(plugin)
			// @ts-expect-error
			.get('/', ({ hi }) => typeof hi === 'undefined')

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('true')
	})

	it('derive in order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.derive(() => {
				order.push('A')
				return {}
			})
			.derive(() => {
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
			.derive(({ store }) => ({
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
			.derive(({ headers: { name } }) => ({
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

	it('as global', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.derive({ as: 'global' }, ({ path }) => {
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
			.derive({ as: 'local' }, ({ path }) => {
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

	it('as scoped', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.derive({ as: 'scoped' }, ({ path }) => {
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
		const app = new Elysia()
			.derive(() => {
				return error(418)
			})
			.get('/', () => '')

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toEqual("I'm a teapot")
	})

	// it('work inline', async () => {
	// 	const app = new Elysia().get('/', ({ hi }) => hi(), {
	// 		derive: () => ({
	// 			hi: () => 'hi'
	// 		})
	// 	})

	// 	const res = await app.handle(req('/')).then((t) => t.text())
	// 	expect(res).toBe('hi')
	// })

	// it('work inline array', async () => {
	// 	const app = new Elysia().get(
	// 		'/',
	// 		({ first, last }) => [last, first].join(' '),
	// 		{
	// 			derive: [
	// 				() => ({
	// 					first: 'himari'
	// 				}),
	// 				() => ({ last: 'akeboshi' })
	// 			]
	// 		}
	// 	)

	// 	const res = await app.handle(req('/')).then((t) => t.text())
	// 	expect(res).toBe('akeboshi himari')
	// })

	// it('work group guard', async () => {
	// 	const app = new Elysia()
	// 		.guard(
	// 			{
	// 				derive: () => ({ hi: () => 'hi' })
	// 			},
	// 			(app) => app.get('/', ({ hi }) => hi())
	// 		)
	// 		// @ts-expect-error
	// 		.get('/nope', ({ hi }) => hi?.() ?? 'nope')

	// 	const res = await app.handle(req('/')).then((t) => t.text())
	// 	expect(res).toBe('hi')

	// 	const nope = await app.handle(req('/nope')).then((t) => t.text())
	// 	expect(nope).toBe('nope')
	// })

	// it('work group array guard', async () => {
	// 	const app = new Elysia()
	// 		.guard(
	// 			{
	// 				derive: [
	// 					() => ({ first: 'himari' }),
	// 					() => ({ last: 'akeboshi' })
	// 				]
	// 			},
	// 			(app) =>
	// 				app.get('/', ({ first, last }) => [last, first].join(' '))
	// 		)
	// 		// @ts-expect-error
	// 		.get('/nope', ({ first, last }) => [last, first].join(''))

	// 	const res = await app.handle(req('/')).then((t) => t.text())
	// 	expect(res).toBe('akeboshi himari')

	// 	const nope = await app.handle(req('/nope')).then((t) => t.text())
	// 	expect(nope).toBe('')
	// })

	// it('work local guard', async () => {
	// 	const app = new Elysia()
	// 		.guard({
	// 			derive: () => ({ hi: () => 'hi' })
	// 		})
	// 		.get('/', ({ hi }) => hi())

	// 	const res = await app.handle(req('/')).then((t) => t.text())
	// 	expect(res).toBe('hi')
	// })

	// it('work local array guard', async () => {
	// 	const app = new Elysia()
	// 		.guard({
	// 			derive: [
	// 				() => ({
	// 					first: 'himari'
	// 				}),
	// 				() => ({ last: 'akeboshi' })
	// 			]
	// 		})
	// 		.get('/', ({ first, last }) => [last, first].join(' '))

	// 	const res = await app.handle(req('/')).then((t) => t.text())
	// 	expect(res).toBe('akeboshi himari')
	// })

	// it('work scoped guard', async () => {
	// 	const plugin = new Elysia().guard({
	// 		as: 'scoped',
	// 		derive: () => ({ hi: () => 'hi' })
	// 	})

	// 	const app = new Elysia().use(plugin).get('/', ({ hi }) => hi())

	// 	const root = new Elysia()
	// 		.use(app)
	// 		// @ts-expect-error
	// 		.get('/root', ({ hi }) => hi?.() ?? 'nope')

	// 	const res = await app.handle(req('/')).then((t) => t.text())
	// 	expect(res).toBe('hi')

	// 	const res2 = await root.handle(req('/root')).then((t) => t.text())
	// 	expect(res2).toBe('nope')
	// })

	// it('work global guard', async () => {
	// 	const plugin = new Elysia().guard({
	// 		as: 'global',
	// 		derive: () => ({ hi: () => 'hi' })
	// 	})

	// 	const app = new Elysia().use(plugin).get('/', ({ hi }) => hi())

	// 	const root = new Elysia()
	// 		.use(app)
	// 		.get('/root', ({ hi }) => hi?.() ?? 'nope')

	// 	const res = await app.handle(req('/')).then((t) => t.text())
	// 	expect(res).toBe('hi')

	// 	const res2 = await root.handle(req('/root')).then((t) => t.text())
	// 	expect(res2).toBe('hi')
	// })

	it('handle return derive without throw', async () => {
		let isOnErrorCalled = false

		const app = new Elysia()
			.onError(() => {
				isOnErrorCalled = true
			})
			.derive(({ status }) => status(418))
			.get('/', () => '')

		await app.handle(req('/'))

		expect(isOnErrorCalled).toBe(false)
	})
})
