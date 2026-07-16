import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

describe('custom HTTP methods', () => {
	it('matches an uppercase request when the registered method is lowercase', async () => {
		const app = new Elysia().method('purge', '/cache', () => 'purged')

		const response = await app.handle(
			new Request('http://localhost/cache', { method: 'PURGE' })
		)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('purged')
	})
})
