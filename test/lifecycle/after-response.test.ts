import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('After Handle', () => {
	it('set response status', async () => {
		let status: number

		const app = new Elysia()
			.onAfterResponse(({ set }) => {
				status = set.status as number
			})
			.get('/error', (c) => c.status(401, { error: 'Unauthorized' }))

		const res = await app.handle(req('/error')).then((x) => x.json())
		expect(res).toEqual({ error: 'Unauthorized' })

		await Bun.sleep(1)
		expect(status!).toBe(401)
	})

	it('set response status for default 404', async () => {
		let status: number

		const app = new Elysia().onAfterResponse(({ set }) => {
			status = set.status as number
		})

		const res = await app.handle(req('/error'))
		expect(res.status).toEqual(404)

		await Bun.sleep(1)
		expect(status!).toBe(404)
	})

	it('preserve request.url', async () => {
		let url: string

		const app = new Elysia()
			.onAfterResponse(({ request }) => {
				url = request.url
			})
			.get('/hello/page', () => 'hi')

		const res = await app.handle(req('/hello/page?foo=bar'))
		expect(res.status).toBe(200)

		await Bun.sleep(1)
		expect(url!).toBe('http://localhost/hello/page?foo=bar')
	})
})
