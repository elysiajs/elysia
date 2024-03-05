import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('After Handle', () => {
	it('work global', async () => {
		const app = new Elysia().onAfterHandle(() => 'A').get('/', () => 'NOOP')

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('A')
	})

	it('work local', async () => {
		const app = new Elysia().get('/', () => 'NOOP', {
			afterHandle() {
				return 'A'
			}
		})

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('A')
	})

	it('inherits from plugin', async () => {
		const transformType = new Elysia().onAfterHandle(
			{ as: 'global' },
			({ response }) => {
				if (response === 'string') return 'number'
			}
		)

		const app = new Elysia()
			.use(transformType)
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('number')
	})

	it('not inherits plugin on local', async () => {
		const transformType = new Elysia().onAfterHandle(({ response }) => {
			if (response === 'string') return 'number'
		})

		const app = new Elysia()
			.use(transformType)
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('string')
	})

	it('register using on', async () => {
		const app = new Elysia()
			.on('transform', (request) => {
				if (request.params?.id) request.params.id = +request.params.id
			})
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('number')
	})

	it('after handle in order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.onAfterHandle(() => {
				order.push('A')
			})
			.onAfterHandle(() => {
				order.push('B')
			})
			.get('/', () => '')

		await app.handle(req('/'))

		expect(order).toEqual(['A', 'B'])
	})

	it('accept response', async () => {
		const app = new Elysia().get('/', () => 'NOOP', {
			afterHandle({ response }) {
				return response
			}
		})

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('NOOP')
	})

	it('as global', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.onAfterHandle({ as: 'global' }, ({ path }) => {
				called.push(path)
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
			.onAfterHandle({ as: 'local' }, ({ path }) => {
				called.push(path)
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
})
