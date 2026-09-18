import { describe, it, expect } from 'bun:test'

import Elysia, { status, t } from '../../src'

describe('Status', () => {
	it('work', async () => {
		const app = new Elysia().get('/', ({ status }) => status(201))

		const response = await app.handle('/')

		expect(response.status).toBe(201)
		await expect(response.text()).resolves.toBe('Created')
	})

	// Bun support 101 or >= 200 status
	it('ignore response body of 101', async () => {
		const app = new Elysia().get('/', ({ status }) => status(101))

		const response = await app.handle('/')

		expect(response.status).toBe(101)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 101', async () => {
		const app = new Elysia().get('/', ({ status }) => status(101, 'Hello'))

		const response = await app.handle('/')

		expect(response.status).toBe(101)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore response body of 204', async () => {
		const app = new Elysia().get('/', ({ status }) => status(204))

		const response = await app.handle('/')

		expect(response.status).toBe(204)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 204', async () => {
		const app = new Elysia().get('/', ({ status }) => status(204, 'Hello'))

		const response = await app.handle('/')

		expect(response.status).toBe(204)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore response body of 205', async () => {
		const app = new Elysia().get('/', ({ status }) => status(205))

		const response = await app.handle('/')

		expect(response.status).toBe(205)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 205', async () => {
		const app = new Elysia().get('/', ({ status }) => status(205, 'Hello'))

		const response = await app.handle('/')

		expect(response.status).toBe(205)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore response body of 304', async () => {
		const app = new Elysia().get('/', ({ status }) => status(304))

		const response = await app.handle('/')

		expect(response.status).toBe(304)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 304', async () => {
		const app = new Elysia().get('/', ({ status }) => status(304, 'Hello'))

		const response = await app.handle('/')

		expect(response.status).toBe(304)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore response body of 307', async () => {
		const app = new Elysia().get('/', ({ status }) => status(307))

		const response = await app.handle('/')

		expect(response.status).toBe(307)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 307', async () => {
		const app = new Elysia().get('/', ({ status }) => status(307, 'Hello'))

		const response = await app.handle('/')

		expect(response.status).toBe(307)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore response body of 308', async () => {
		const app = new Elysia().get('/', ({ status }) => status(308))

		const response = await app.handle('/')

		expect(response.status).toBe(308)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 308', async () => {
		const app = new Elysia().get('/', ({ status }) => status(308, 'Hello'))

		const response = await app.handle('/')

		expect(response.status).toBe(308)
		await expect(response.text()).resolves.toBe('')
	})

	// The numeric field is `status`, not `code`: `code` is now the string
	// token an error serves, and one module can't spell both with one word.
	// A name is resolved on the way in, so the field is always the number
	it('carry the resolved number on `status`', () => {
		const named = status('Payment Required', 'nope')

		expect(named.status).toBe(402)
		expect(named.response).toBe('nope')
		expect(named).not.toHaveProperty('code')

		expect(status(201).status).toBe(201)
		// an empty status still resolves, it only drops the body
		expect(status(204).status).toBe(204)
		expect(status(204).response).toBeUndefined()
	})

	// The rename cost `ElysiaStatus` its structural discriminator — `status` +
	// `response` is a shape a handler may write by hand, so a type-only brand
	// keeps a plain literal out of the status lane
	it('serve a hand-written status-shaped object as a plain body', async () => {
		const app = new Elysia().get(
			'/',
			() => ({ status: 401, response: 'c' }) as const
		)

		const response = await app.handle('/')

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			status: 401,
			response: 'c'
		})
	})
})
