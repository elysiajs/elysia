import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'

describe('compiled cookie header access', () => {
	it('creates an empty cookie jar when a headers schema omits Cookie', async () => {
		const app = new Elysia().get(
			'/',
			{ headers: t.Object({ 'x-token': t.Optional(t.String()) }) },
			({ cookie }) => Object.keys(cookie).length
		)

		const response = await app.handle(new Request('http://localhost/'))
		expect(response.status).toBe(200)
		await expect(response.text()).resolves.toBe('0')
	})

	it('reads Cookie when a headers schema omits it', async () => {
		const app = new Elysia().get(
			'/',
			{ headers: t.Object({ 'x-token': t.Optional(t.String()) }) },
			({ cookie }) => cookie.session.value ?? ''
		)

		const response = await app.handle(
			new Request('http://localhost/', {
				headers: { cookie: 'session=hello' }
			})
		)
		expect(response.status).toBe(200)
		await expect(response.text()).resolves.toBe('hello')
	})

	it('reads Cookie when headers are destructured without a schema', async () => {
		const app = new Elysia().get(
			'/',
			({ headers, cookie }) => cookie.session?.value ?? 'none'
		)

		const withCookie = await app.handle(
			new Request('http://localhost/', {
				headers: { cookie: 'session=hello' }
			})
		)
		expect(withCookie.status).toBe(200)
		await expect(withCookie.text()).resolves.toBe('hello')

		const withoutCookie = await app.handle(new Request('http://localhost/'))
		expect(withoutCookie.status).toBe(200)
		await expect(withoutCookie.text()).resolves.toBe('none')
	})
})
