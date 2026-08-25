import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'

describe('Promise-returning hooks', () => {
	it('.request() returning a Promise<undefined> continues to the handler', async () => {
		const app = new Elysia()
			.request(() => new Promise<void>((resolve) => resolve()) as any)
			.get('/', () => 'handler')

		const res = await app.handle('/')

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('handler')
	})

	it('.request() returning a resolved value short-circuits with that value', async () => {
		const app = new Elysia()
			.request(() => new Promise<string>((resolve) => resolve('early')))
			.get('/', () => 'handler')

		const res = await app.handle('/')

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('early')
	})

	it('beforeHandle returning a Promise<undefined> reaches the handler', async () => {
		const app = new Elysia().get(
			'/',
			{
				beforeHandle: () =>
					new Promise<void>((resolve) => resolve()) as any
			},
			() => 'handler'
		)

		const res = await app.handle('/')

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('handler')
	})

	it('beforeHandle returning a resolved value short-circuits with that value', async () => {
		const app = new Elysia().get(
			'/',
			{
				beforeHandle: () =>
					new Promise<string>((resolve) => resolve('before'))
			},
			() => 'handler'
		)

		const res = await app.handle('/')

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('before')
	})

	it('error hook returning a Promise<undefined> falls back to the real error', async () => {
		const app = new Elysia()
			.error(() => new Promise<void>((resolve) => resolve()) as any)
			.get('/', () => {
				throw new Error('boom')
			})

		const res = await app.handle('/')

		expect(res.status).toBe(500)
		const body = await res.text()
		expect(body).not.toBe('')
		expect(body).toContain('boom')
	})

	it('error hook returning a resolved value uses that as the error response', async () => {
		const app = new Elysia()
			.error(() => new Promise<string>((resolve) => resolve('handled')))
			.get('/', () => {
				throw new Error('boom')
			})

		const res = await app.handle('/')

		await expect(res.text()).resolves.toBe('handled')
	})

	it('Standard Schema response whose sync validate() returns a Promise is awaited', async () => {
		const promiseSchema: any = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: (value: unknown) =>
					new Promise((resolve) => resolve({ value }))
			}
		}

		const app = new Elysia().get('/', { response: promiseSchema }, () => ({
			ok: true
		}))

		const res = await app.handle('/')

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ ok: true })
	})
})
