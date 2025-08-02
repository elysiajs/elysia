import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('On After Response', () => {
	it('call after response in error', async () => {
		let isAfterResponseCalled = false

		const app = new Elysia()
			.onAfterResponse(() => {
				isAfterResponseCalled = true
			})
			.onError(() => {
				return new Response('a', {
					status: 401,
					headers: {
						awd: 'b'
					}
				})
			})

		await app.handle(req('/'))
		// wait for next tick
		await Bun.sleep(1)

		expect(isAfterResponseCalled).toBeTrue()
	})

	it('call after response on not found without error handler', async () => {
		let isAfterResponseCalled = false

		const app = new Elysia()
			.onAfterResponse(() => {
				isAfterResponseCalled = true
			})

		await app.handle(req('/'))
		// wait for next tick
		await Bun.sleep(1)

		expect(isAfterResponseCalled).toBeTrue()
	})

	it('response in order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.onAfterResponse(() => {
				order.push('A')
			})
			.onAfterResponse(() => {
				order.push('B')
			})
			.get('/', () => '')

		await app.handle(req('/'))
		// wait for next tick
		await Bun.sleep(1)

		expect(order).toEqual(['A', 'B'])
	})

	// it('inherits from plugin', async () => {
	// 	const transformType = new Elysia().onResponse(
	// 		{ as: 'global' },
	// 		({ response }) => {
	// 			if (response === 'string') return 'number'
	// 		}
	// 	)

	// 	const app = new Elysia()
	// 		.use(transformType)
	// 		.get('/id/:id', ({ params: { id } }) => typeof id)

	// 	const res = await app.handle(req('/id/1'))

	// 	expect(await res.text()).toBe('number')
	// })

	it('as global', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.onAfterResponse({ as: 'global' }, ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		const res = await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])
		// wait for next tick
		await Bun.sleep(1)

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('as local', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.onAfterResponse({ as: 'local' }, ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		const res = await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])
		// wait for next tick
		await Bun.sleep(1)

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
		// wait for next tick
		await Bun.sleep(1)

		expect(total).toEqual(2)
	})
})
