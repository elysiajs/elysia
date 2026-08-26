import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('HTTP QUERY Method', () => {
	it('handle QUERY request', async () => {
		const app = new Elysia().query('/', () => 'QUERY')

		const res = await app.handle(
			req('/', {
				method: 'QUERY'
			})
		)

		expect(await res.text()).toBe('QUERY')
	})

	it('handle QUERY request with body', async () => {
		const app = new Elysia().query(
			'/',
			({ body }) => body,
			{
				body: t.Object({
					name: t.String()
				})
			}
		)

		const res = await app.handle(
			req('/', {
				method: 'QUERY',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ name: 'Elysia' })
			})
		)

		expect(await res.json()).toEqual({ name: 'Elysia' })
	})

	it('return 404 for non-QUERY request', async () => {
		const app = new Elysia().query('/', () => 'QUERY')

		const res = await app.handle(req('/'))

		expect(res.status).toBe(404)
	})
})
