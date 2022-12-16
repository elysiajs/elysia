import { Elysia } from '../src'

import { describe, expect, it } from 'bun:test'
import { req } from './utils'

describe('Guard', () => {
	it('combine local and global', async () => {
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
})
