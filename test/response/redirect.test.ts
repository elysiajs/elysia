import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Response Redirect', () => {
	it('handle redirect', async () => {
		const app = new Elysia().get('/', ({ redirect }) => redirect('/skadi'))

		const { headers, status } = await app.handle(req('/'))

		expect(status).toBe(302)
		expect(headers.toJSON()).toEqual({
			location: '/skadi'
		})
	})

	it('handle redirect status', async () => {
		const app = new Elysia().get('/', ({ redirect }) =>
			redirect('/skadi', 301)
		)

		const { headers, status } = await app.handle(req('/'))

		expect(status).toBe(301)
		expect(headers.toJSON()).toEqual({
			location: '/skadi'
		})
	})

	it('add set.headers to redirect', async () => {
		const app = new Elysia().get('/', ({ redirect, set }) => {
			set.headers.alias = 'Abyssal Hunter'

			return redirect('/skadi')
		})

		const { headers, status } = await app.handle(req('/'))

		expect(status).toBe(302)
		expect(headers.toJSON()).toEqual({
			location: '/skadi',
			alias: 'Abyssal Hunter'
		})
	})

	it('set multiple cookie on redirect', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie: { name, name2 }, redirect }) => {
				name.value = 'a'
				name2.value = 'b'

				return redirect('/skadi')
			}
		)

		const { headers, status } = await app.handle(req('/'))

		expect(status).toBe(302)
		// @ts-expect-error
		expect(headers.toJSON()).toEqual({
			location: '/skadi',
			'set-cookie': ['name=a; Path=/', 'name2=b; Path=/']
		})
	})

	it('preserves relative locations across every redirect status', async () => {
		for (const status of [301, 302, 303, 307, 308] as const) {
			const app = new Elysia().get('/', ({ redirect }) =>
				redirect('/login', status)
			)

			const response = await app.handle(req('/'))

			expect(response.status).toBe(status)
			expect(response.headers.get('location')).toBe('/login')
		}
	})

	it('preserves an absolute redirect location', async () => {
		const app = new Elysia().get('/', ({ redirect }) =>
			redirect('https://example.com/dashboard')
		)

		const response = await app.handle(req('/'))

		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe(
			'https://example.com/dashboard'
		)
	})

	it('percent-encodes relative unicode location', async () => {
		const app = new Elysia().get('/', ({ redirect }) => redirect('/путь'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe(encodeURI('/путь'))
	})

	it('percent-encodes absolute unicode location', async () => {
		const app = new Elysia().get('/', ({ redirect }) =>
			redirect('https://例え.jp/x')
		)

		const response = await app.handle(req('/'))

		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe(
			encodeURI('https://例え.jp/x')
		)
	})

	it('does not double-encode pre-encoded sequences in unicode url', async () => {
		const app = new Elysia().get('/', ({ redirect }) =>
			redirect('/путь?q=a%20b')
		)

		const response = await app.handle(req('/'))

		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe(
			encodeURI('/путь?q=a%20b')
		)
	})

	it('leaves plain ASCII url byte-identical', async () => {
		const app = new Elysia().get('/', ({ redirect }) => redirect('/a%20b'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe('/a%20b')
	})
})
