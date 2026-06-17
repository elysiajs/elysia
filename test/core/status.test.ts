import { describe, it, expect } from 'bun:test'

import Elysia, { t } from '../../src'
import { req } from '../utils'

describe('Status', () => {
	it('work', async () => {
		const app = new Elysia().get('/', ({ status }) => status(201))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(201)
		await expect(response.text()).resolves.toBe('Created')
	})

	// Bun support 101 or >= 200 status
	it('ignore response body of 101', async () => {
		const app = new Elysia().get('/', ({ status }) => status(101))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(101)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 101', async () => {
		const app = new Elysia().get('/', ({ status }) => status(101, 'Hello'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(101)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore response body of 204', async () => {
		const app = new Elysia().get('/', ({ status }) => status(204))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(204)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 204', async () => {
		const app = new Elysia().get('/', ({ status }) => status(204, 'Hello'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(204)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore response body of 205', async () => {
		const app = new Elysia().get('/', ({ status }) => status(205))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(205)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 205', async () => {
		const app = new Elysia().get('/', ({ status }) => status(205, 'Hello'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(205)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore response body of 304', async () => {
		const app = new Elysia().get('/', ({ status }) => status(304))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(304)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 304', async () => {
		const app = new Elysia().get('/', ({ status }) => status(304, 'Hello'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(304)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore response body of 307', async () => {
		const app = new Elysia().get('/', ({ status }) => status(307))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(307)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 307', async () => {
		const app = new Elysia().get('/', ({ status }) => status(307, 'Hello'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(307)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore response body of 308', async () => {
		const app = new Elysia().get('/', ({ status }) => status(308))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(308)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 308', async () => {
		const app = new Elysia().get('/', ({ status }) => status(308, 'Hello'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(308)
		await expect(response.text()).resolves.toBe('')
	})
})
