import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Plugin', () => {
	it('await async nested plugin', async () => {
		const yay = async () => {
			await Bun.sleep(2)

			return new Elysia({ name: 'yay' }).get('/yay', 'yay')
		}

		const wrapper = new Elysia({ name: 'wrapper' }).use(yay())

		const app = new Elysia().use(wrapper)

		await app.modules

		const response = await app.handle(req('/yay'))

		expect(response.status).toBe(200)
	})

	it('use([...]) dispatches promise, functional, and instance plugins', async () => {
		const asyncPlugin = (async () => {
			await Bun.sleep(2)
			return new Elysia({ name: 'async' }).get('/async', 'async')
		})()
		const fnPlugin = (app: Elysia) => app.get('/fn', 'fn')
		const instancePlugin = new Elysia({ name: 'instance' }).get(
			'/instance',
			'instance'
		)

		const app = new Elysia()
			// The typed overload models only Elysia instance arrays.
			.use([asyncPlugin, fnPlugin, instancePlugin] as any)
			.get('/', 'root')

		await app.modules

		for (const path of ['/async', '/fn', '/instance', '/']) {
			const response = await app.handle(req(path))
			expect(response.status).toBe(200)
		}
	})
})
