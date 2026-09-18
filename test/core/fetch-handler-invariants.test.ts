import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'

describe('fetch handler', () => {
	it('returns 404 for an unmatched static-only app with a request hook', async () => {
		const app = new Elysia().request(() => {}).get('/exists', () => 'hi')

		const res = await app.handle('/nope')

		expect(res.status).toBe(404)
		await expect(res.json()).resolves.toEqual({
			type: 'not-found',
			code: 'not-found',
			title: 'Not Found',
			status: 404
		})
	})

	it('keeps HTTP 500 when an error hook returns a plain object with a status property', async () => {
		const app = new Elysia()
			.error(() => ({ status: 'pending', message: 'retry' }))
			.get('/', () => {
				throw new Error('boom')
			})

		const res = await app.handle('/')

		expect(res.status).toBe(500)
		await expect(res.json()).resolves.toEqual({
			status: 'pending',
			message: 'retry'
		})
	})

	it('uses an explicit status returned from an error hook', async () => {
		const app = new Elysia()
			.error(({ status }) => status(418, 'teapot'))
			.get('/', () => {
				throw new Error('boom')
			})

		const res = await app.handle('/')

		expect(res.status).toBe(418)
		await expect(res.text()).resolves.toBe('teapot')
	})

	it('runs afterResponse when a sync request hook returns a response', async () => {
		let ran = false

		const app = new Elysia()
			.request(({ set }) => {
				set.status = 418
				return 'sc'
			})
			.afterResponse(() => {
				ran = true
			})
			.get('/x', () => 'real')

		const res = await app.handle('/x')
		expect(res.status).toBe(418)

		await Bun.sleep(1)
		expect(ran).toBe(true)
	})

	it('runs afterResponse when an async request hook returns a response', async () => {
		let ran = false

		const app = new Elysia()
			.request(async ({ set }) => {
				set.status = 418
				return 'sc'
			})
			.afterResponse(() => {
				ran = true
			})
			.get('/x', () => 'real')

		const res = await app.handle('/x')
		expect(res.status).toBe(418)

		await Bun.sleep(1)
		expect(ran).toBe(true)
	})

	it('includes configured default headers in the default 404 response', async () => {
		const app = new Elysia()
			.headers({ 'x-powered-by': 'elysia' })
			.get('/exists', () => 'hi')

		const hit = await app.handle('/exists')
		expect(hit.headers.get('x-powered-by')).toBe('elysia')

		const miss = await app.handle('/missing')
		expect(miss.status).toBe(404)
		expect(miss.headers.get('x-powered-by')).toBe('elysia')
	})

	it('includes request-hook headers in the default 404 response', async () => {
		const app = new Elysia()
			.request(({ set }) => {
				set.headers['x-from-hook'] = 'yes'
			})
			.get('/exists', () => 'hi')

		const miss = await app.handle('/missing')
		expect(miss.status).toBe(404)
		expect(miss.headers.get('x-from-hook')).toBe('yes')
	})

	it('afterResponse observes the status chosen by an error hook for a missing route', async () => {
		let observed: number | undefined

		const app = new Elysia()
			.error(({ set }) => {
				set.status = 418
				return 'teapot'
			})
			.afterResponse(({ set }) => {
				observed = set.status as number
			})
			.get('/x', () => 'real')

		const res = await app.handle('/missing')
		expect(res.status).toBe(418)
		await expect(res.text()).resolves.toBe('teapot')

		await Bun.sleep(1)
		expect(observed).toBe(418)
	})
})
