import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

describe('Redirect', () => {
	it('handles redirect without explicit status', async () => {
		const app = new Elysia().get('/', ({ set, redirect }) =>
			redirect('/hello')
		)

		const res = await app.handle('/')
		expect(res.status).toBe(302)
		expect(res.headers.get('location')).toBe('/hello')
	})

	it('handles redirect with explicit status', async () => {
		const app = new Elysia().get('/', ({ set, redirect }) =>
			redirect('/hello', 303)
		)

		const res = await app.handle('/')
		expect(res.status).toBe(303)
		expect(res.headers.get('location')).toBe('/hello')
	})
})
