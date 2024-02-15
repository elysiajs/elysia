import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('On Response', () => {
	it('inherits set if Response is return', async () => {
		const app = new Elysia()
			.onResponse(({ set }) => {
				expect(set.status).toBe(401)
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
	})

	it('scoped true', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.onResponse({ scoped: true }, ({ path }) => {
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

	it('scoped false', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.onResponse({ scoped: false }, ({ path }) => {
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
