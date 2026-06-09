/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { req } from '../utils'

describe('HOC', () => {
	it('work', async () => {
		let called = 0

		const app = new Elysia()
			.wrap((fn) => {
				called++

				return fn
			})
			.get('/', () => 'ok')

		await app.handle(req('/'))

		expect(called).toBe(1)
	})

	it('deduplicate', async () => {
		const plugin = new Elysia().wrap((fn) => fn)
		const plugin2 = new Elysia({ name: 'plugin2' }).wrap((fn) => fn)

		const app = new Elysia()
			.use(plugin)
			.use(plugin)
			.use(plugin)
			.use(plugin2)
			.use(plugin2)
			.get('/', () => 'ok')

		// @ts-expect-error
		expect(app.extender.higherOrderFunctions.length).toBe(2)
	})
})
