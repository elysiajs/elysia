import { Elysia, t } from '../../src'
import { describe, it, expect, beforeEach } from 'bun:test'

describe('NODE_ENV=production', () => {
	beforeEach(() => {
		process.env.NODE_ENV = 'production'
	})

	it('omit error summary', async () => {
		const app = new Elysia()
			.post('/', () => 'yay', {
				body: t.Object({
					name: t.String()
				})
			})

		const response = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				body: ''
			})
		)

		const text = await response.text()
		expect(text).not.toEqual(
			'Right side of assignment cannot be destructured'
		)
	})
})
