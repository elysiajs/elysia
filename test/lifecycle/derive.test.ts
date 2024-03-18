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
})
