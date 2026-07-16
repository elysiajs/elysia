import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('afterResponse status', () => {
	it('observes an explicit response status', async () => {
		let status: number

		const app = new Elysia()
			.afterResponse(({ set }) => {
				status = set.status as number
			})
			.get('/error', (c) => c.status(401, { error: 'Unauthorized' }))

		const res = await app.handle(req('/error')).then((x) => x.json())
		expect(res).toEqual({ error: 'Unauthorized' })

		await Bun.sleep(1)
		expect(status!).toBe(401)
	})

	it('observes the default status for a missing route', async () => {
		let status: number

		const app = new Elysia().afterResponse(({ set }) => {
			status = set.status as number
		})

		const res = await app.handle(req('/error'))
		expect(res.status).toEqual(404)

		await Bun.sleep(1)
		expect(status!).toBe(404)
	})
})
