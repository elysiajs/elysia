import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'

describe('Cookie - Unchanged Values', () => {
	it('should not send set-cookie header when cookie is only read', async () => {
		const app = new Elysia()
			.guard({
				cookie: t.Cookie({
					value: t.Optional(
						t.Object({
							a: t.String(),
							b: t.String()
						})
					)
				})
			})
			.get('/cookie', ({ cookie: { value } }) => value.value)
			.post('/cookie', ({ cookie: { value } }) => {
				value.value = { a: '1', b: '2' }
				return 'ok'
			})

		// POST request should set cookie
		const postResponse = await app.handle(
			new Request('http://localhost/cookie', {
				method: 'POST'
			})
		)

		const setCookieHeaders = postResponse.headers.getAll('set-cookie')
		expect(setCookieHeaders.length).toBeGreaterThan(0)

		// GET request should NOT set cookie (only reading)
		const getResponse = await app.handle(
			new Request('http://localhost/cookie', {
				method: 'GET',
				headers: {
					cookie: setCookieHeaders[0].split(';')[0]
				}
			})
		)

		const getSetCookieHeaders = getResponse.headers.getAll('set-cookie')
		expect(getSetCookieHeaders.length).toBe(0)
	})

	it.only('should send set-cookie header when setting same value', async () => {
		const app = new Elysia().get('/same', ({ cookie: { session } }) => {
			// Setting the same value that came from request
			session.value = 'existing'
			return 'ok'
		})

		const response = await app.handle(
			new Request('http://localhost/same', {
				headers: {
					cookie: 'session=existing'
				}
			})
		)

		expect(response.headers.getAll('set-cookie').length).toBeGreaterThan(0)
	})

	it('should not send set-cookie header when cookie value is accessed but not modified', async () => {
		const app = new Elysia()
			.get('/read', ({ cookie: { session } }) => {
				// Just reading the value
				const val = session.value
				return { read: val }
			})
			.get('/write', ({ cookie: { session } }) => {
				// Writing the value
				session.value = 'test'
				return { written: true }
			})

		// Read endpoint should not set cookie
		const readResponse = await app.handle(
			new Request('http://localhost/read')
		)
		expect(readResponse.headers.getAll('set-cookie').length).toBe(0)

		// Write endpoint should set cookie
		const writeResponse = await app.handle(
			new Request('http://localhost/write')
		)
		expect(
			writeResponse.headers.getAll('set-cookie').length
		).toBeGreaterThan(0)
	})

	it('should send set-cookie header when value actually changes', async () => {
		const app = new Elysia().get('/change', ({ cookie: { session } }) => {
			session.value = 'new-value'
			return 'ok'
		})

		const response = await app.handle(
			new Request('http://localhost/change', {
				headers: {
					cookie: 'session=old-value'
				}
			})
		)

		expect(response.headers.getAll('set-cookie').length).toBeGreaterThan(0)
	})
})
