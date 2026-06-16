import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('After Handle', () => {
	it('work global', async () => {
		const app = new Elysia().afterHandle(() => 'A').get('/', () => 'NOOP')

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
		const transformType = new Elysia().afterHandle(
			'global',
			// @ts-ignore
			({ responseValue }) => {
				if (responseValue === 'string') return 'number'
			}
		)

		const app = new Elysia()
			.use(transformType)
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('number')
	})

	it('not inherits plugin on local', async () => {
		// @ts-ignore
		const transformType = new Elysia().afterHandle(({ responseValue }) => {
			if (responseValue === 'string') return 'number'
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
			.afterHandle(() => {
				order.push('A')
			})
			.afterHandle(() => {
				order.push('B')
			})
			.get('/', () => '')

		await app.handle(req('/'))

		expect(order).toEqual(['A', 'B'])
	})

	it('accept responseValue', async () => {
		const app = new Elysia().get('/', () => 'NOOP', {
			afterHandle({ responseValue }) {
				return responseValue
			},
			mapResponse() {

			}
		})

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('NOOP')
	})

	it('as global', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.afterHandle('global', ({ path }) => {
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
			.afterHandle('local', ({ path }) => {
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

	// New direct-scope API: `afterHandle('global', fn)` parallels
	// `onAfterHandle('global', fn)`.
	it('as global (direct scope)', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.afterHandle('global', ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('as local (direct scope)', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.afterHandle('local', ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner'])
	})

	it('support array', async () => {
		let total = 0

		const app = new Elysia()
			.afterHandle([
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
