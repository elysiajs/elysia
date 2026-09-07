import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'

describe('afterResponse after thrown errors', () => {
	it('runs when a synchronous request hook throws', async () => {
		let complete!: (ran: boolean) => void
		const completed = new Promise<boolean>(
			(resolve) => (complete = resolve)
		)
		const app = new Elysia()
			.request(() => {
				throw new Error('boom')
			})
			.afterResponse(() => {
				complete(true)
			})
			.get('/x', () => 'x')

		const res = await app.handle('/x')
		expect(res.status).toBe(500)
		await expect(completed).resolves.toBe(true)
	})

	it('observes the final status from an async error hook after a request hook throws', async () => {
		let complete!: (status: number) => void
		const completed = new Promise<number>((resolve) => (complete = resolve))
		const app = new Elysia()
			.error(async () => {
				await Promise.resolve()
				return new Response('teapot', { status: 418 })
			})
			.request(async () => {
				await Promise.resolve()
				throw new Error('boom')
			})
			.afterResponse((ctx) => {
				complete(ctx.set.status as number)
			})
			.get('/y', () => 'y')

		const res = await app.handle('/y')
		expect(res.status).toBe(418)
		await expect(completed).resolves.toBe(418)
	})

	it('observes the final status from an async error hook after a route throws', async () => {
		let complete!: (status: number) => void
		const completed = new Promise<number>((resolve) => (complete = resolve))
		const app = new Elysia()
			.error(async () => {
				await Promise.resolve()
				return new Response('teapot', { status: 418 })
			})
			.afterResponse((ctx) => {
				complete(ctx.set.status as number)
			})
			.get('/z', () => {
				throw new Error('boom')
			})

		const res = await app.handle('/z')
		expect(res.status).toBe(418)
		await expect(completed).resolves.toBe(418)
	})
})
