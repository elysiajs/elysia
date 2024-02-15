import { Elysia } from '../../src'

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
		const plugin = () => (app: Elysia) =>
			app.resolve(() => ({
				hi: () => 'hi'
			}))

		const app = new Elysia().use(plugin()).get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')
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

	it('scoped true', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.resolve({ scoped: true }, ({ path }) => {
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

	it('scoped false', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.resolve({ scoped: false }, ({ path }) => {
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
})
