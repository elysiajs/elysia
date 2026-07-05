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

	// node-divergence-1: redirect() must construct a valid Response for a
	// RELATIVE url on every runtime. `Response.redirect(url, status)` requires
	// an absolute URL per WHATWG; Node/undici throws `TypeError: Failed to
	// parse URL` on a relative url (→ opaque 500), while Bun accepts it. So
	// `redirect('/login')` worked on Bun but 500'd on Node. The fix builds the
	// redirect as `new Response(null, { status, headers: { location } })`,
	// which both runtimes accept verbatim. We assert the runtime-agnostic
	// contract here: every redirect status keeps the relative location + status
	// without throwing. (CI is Bun-only — this can't exercise Node's undici
	// directly — so it pins the contract that makes both runtimes agree.)
	it('preserve relative location across every redirect status (node-safe)', async () => {
		for (const status of [301, 302, 303, 307, 308] as const) {
			const app = new Elysia().get('/', ({ redirect }) =>
				redirect('/login', status)
			)

			const response = await app.handle(req('/'))

			expect(response.status).toBe(status)
			expect(response.headers.get('location')).toBe('/login')
		}
	})

	it('preserve absolute location on redirect (node-safe)', async () => {
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
		const app = new Elysia().get('/', ({ redirect }) =>
			redirect('/путь')
		)

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
		const app = new Elysia().get('/', ({ redirect }) =>
			redirect('/a%20b')
		)

		const response = await app.handle(req('/'))

		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe('/a%20b')
	})
})
