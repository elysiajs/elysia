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
