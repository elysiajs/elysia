import { Elysia } from '../src'

import { describe, expect, it } from 'bun:test'
import { req } from './utils'

describe('Guard', () => {
	it('inherits global', async () => {
		const app = new Elysia().state('counter', 0).guard(
			{
				transform: ({ store }) => {
					store.counter++
				}
			},
			(app) =>
				app.get('/', ({ store: { counter } }) => counter, {
					transform: ({ store }) => {
						store.counter++
					}
				})
		)

		const valid = await app.handle(req('/'))

		expect(await valid.text()).toBe('2')
	})

	it('delegate onRequest', async () => {
		const app = new Elysia()
			.get('/', () => 'A')
			.guard({}, (app) =>
				app
					.state('counter', 0)
					.onRequest(({ store }) => {
						store.counter++
					})
					.get('/counter', ({ store: { counter } }) => counter)
			)

		await app.handle(req('/'))
		const res = await app.handle(req('/counter')).then((r) => r.text())

		expect(res).toBe('2')
	})
})
