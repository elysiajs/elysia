import { Elysia } from '../../src'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('204 No Content', () => {
	it('should return null body for status No Content', async () => {
		const app = new Elysia().delete('/item', ({ status }) => {
			return status('No Content')
		})

		const response = await app.handle(
			req('/item', { method: 'DELETE' })
		)

		expect(response.status).toBe(204)
		expect(response.body).toBeNull()
	})

	it('should return null body for status No Content even when a message is passed', async () => {
		const app = new Elysia().delete('/item', ({ status }) => {
			return status('No Content', 'Item deleted successfully.')
		})

		const response = await app.handle(
			req('/item', { method: 'DELETE' })
		)

		expect(response.status).toBe(204)
		expect(response.body).toBeNull()
	})

	it('should return null body for status 205 Reset Content', async () => {
		const app = new Elysia().post('/reset', ({ status }) => {
			return status('Reset Content')
		})

		const response = await app.handle(
			req('/reset', { method: 'POST' })
		)

		expect(response.status).toBe(205)
		expect(response.body).toBeNull()
	})
})
