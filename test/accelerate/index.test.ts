/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Accelerate', () => {
	it('works', async () => {
		const app = new Elysia({
			jsonAccelerator: true
		}).get(
			'/',
			() => ({
				hello: 'accelerate'
			}),
			{
				response: t.Object({
					hello: t.String()
				})
			}
		)

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ hello: 'accelerate' })
		expect(response.headers.get('content-type')).toBe('application/json')
	})

	it('works with multiple status', async () => {
		const app = new Elysia({
			jsonAccelerator: true
		}).get(
			'/',
			({ status, query }) =>
				query.status === 200
					? { hello: 'accelerate' }
					: status(400, 'Bad Request'),
			{
				query: t.Object({
					status: t.Number()
				}),
				response: {
					200: t.Object({
						hello: t.Literal('accelerate')
					}),
					400: t.String()
				}
			}
		)

		const responses = await Promise.all([
			app.handle(req('/?status=200')),
			app.handle(req('/?status=400'))
		])

		expect(responses[0].status).toBe(200)
		expect(await responses[0].json()).toEqual({ hello: 'accelerate' })
		expect(responses[0].headers.get('content-type')).toBe(
			'application/json'
		)

		expect(responses[1].status).toBe(400)
		expect(await responses[1].text()).toBe('Bad Request')
	})

	it('handle array', async () => {
		const app = new Elysia({
			jsonAccelerator: true
		}).get('/', () => ['hi'], {
			response: t.Array(t.String())
		})

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual(['hi'])
		expect(response.headers.get('content-type')).toBe('application/json')
	})

	it('handle non-object', async () => {
		const app = new Elysia({
			jsonAccelerator: true
		}).get('/', () => 'hi', {
			response: t.String()
		})

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('hi')
		expect(response.headers.get('content-type')).toBe('text/plain')
	})
})
