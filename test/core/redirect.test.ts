import { describe, expect, it } from 'bun:test'
import Elysia from '../../src'
import { req } from '../utils'

describe('Redirect', () => {
	it('handles redirect without explicit status', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.redirect = '/hello'
		})

		const res = await app.handle(req('/'))
		expect(res.status).toBe(302)
		expect(res.headers.get('location')).toBe('/hello')
	})

	it('handles redirect with explicit status', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.redirect = '/hello'
			set.status = 303
		})

		const res = await app.handle(req('/'))
		expect(res.status).toBe(303)
		expect(res.headers.get('location')).toBe('/hello')
	})
})
