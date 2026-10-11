import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'

describe('afterHandle', () => {
	it('replaces a response from an app hook', async () => {
		const app = new Elysia().onAfterHandle(() => 'A').get('/', () => 'NOOP')

		const res = await app.handle('/').then((x) => x.text())

		expect(res).toBe('A')
	})

	it('replaces a response from a route-local hook', async () => {
		const app = new Elysia().get(
			'/',
			{
				afterHandle() {
					return 'A'
				}
			},
			() => 'NOOP'
		)

		const res = await app.handle('/').then((x) => x.text())

		expect(res).toBe('A')
	})

	it('propagates global hooks out of plugins', async () => {
		const transformType = new Elysia().onAfterHandle(
			'global',
			// @ts-ignore
			({ responseValue }) => {
				if (responseValue === 'string') return 'number'
			}
		)

		const app = new Elysia()
			.use(transformType)
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle('/id/1')

		await expect(res.text()).resolves.toBe('number')
	})

	it('keeps local hooks inside plugins', async () => {
		// @ts-ignore
		const transformType = new Elysia().onAfterHandle(
			({ responseValue }) => {
				if (responseValue === 'string') return 'number'
			}
		)

		const app = new Elysia()
			.use(transformType)
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle('/id/1')

		await expect(res.text()).resolves.toBe('string')
	})

	it('runs hooks in registration order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.onAfterHandle(() => {
				order.push('A')
			})
			.onAfterHandle(() => {
				order.push('B')
			})
			.get('/', () => '')

		await app.handle('/')

		expect(order).toEqual(['A', 'B'])
	})

	it('receives the handler result as responseValue', async () => {
		const app = new Elysia().get(
			'/',
			{
				afterHandle({ responseValue }) {
					return responseValue
				},
				mapResponse() {}
			},
			() => 'NOOP'
		)

		const res = await app.handle('/').then((x) => x.text())

		expect(res).toBe('NOOP')
	})

	it('runs a global plugin hook on plugin and parent routes', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.onAfterHandle('global', ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		await Promise.all([app.handle('/inner'), app.handle('/outer')])

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('runs a local plugin hook only on plugin routes', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.onAfterHandle('local', ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		await Promise.all([app.handle('/inner'), app.handle('/outer')])

		expect(called).toEqual(['/inner'])
	})

	it('accepts an array of hooks', async () => {
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

		const res = await app.handle('/')

		expect(total).toEqual(2)
	})
})
