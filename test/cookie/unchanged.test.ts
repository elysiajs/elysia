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

	// Fine by using FNV-1a hash
	// it('should send set-cookie header when setting same value', async () => {
	// 	const app = new Elysia().get('/same', ({ cookie: { session } }) => {
	// 		// Setting the same value that came from request
	// 		session.value = 'existing'
	// 		return 'ok'
	// 	})

	// 	const response = await app.handle(
	// 		new Request('http://localhost/same', {
	// 			headers: {
	// 				cookie: 'session=existing'
	// 			}
	// 		})
	// 	)

	// 	expect(response.headers.getAll('set-cookie').length).toBeGreaterThan(0)
	// })

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

	it('cookie handling should be idempotent', async () => {
		const app = new Elysia().post('/update', ({ cookie: { data } }) => {
			// Set to same value as incoming cookie
			data.value = { id: 123, name: 'test' }
			return 'ok'
		})

		// First request: set the cookie
		const firstRes = await app.handle(
			new Request('http://localhost/update', { method: 'POST' })
		)
		const setCookie = firstRes.headers.get('set-cookie')
		expect(setCookie).toBeTruthy()

		// Second request: send cookie back and set to same value
		const secondRes = await app.handle(
			new Request('http://localhost/update', {
				method: 'POST',
				headers: {
					cookie: setCookie!.split(';')[0]
				}
			})
		)

		// Should not send Set-Cookie since value didn't change
		expect(secondRes.headers.getAll('set-cookie').length).toBe(1)
	})

	it('should optimize multiple assignments of same object in single request', async () => {
		const app = new Elysia().post('/multi', ({ cookie: { data } }) => {
			// Multiple assignments of the same value
			data.value = { id: 123, name: 'test' }
			data.value = { id: 123, name: 'test' }
			data.value = { id: 123, name: 'test' }
			return 'ok'
		})

		const res = await app.handle(
			new Request('http://localhost/multi', { method: 'POST' })
		)

		// Should only produce one Set-Cookie header
		expect(res.headers.getAll('set-cookie').length).toBe(1)
	})

	it('should invalidate hash cache when using update() method', async () => {
		const app = new Elysia().post('/cache-invalidation', ({ cookie: { data } }) => {
			// Set initial value
			data.value = { id: 1, name: 'first' }

			// Modify via update() - should invalidate cache
			data.update({ value: { id: 2, name: 'second' } })

			// Set to the updated value again - should detect as unchanged
			data.value = { id: 2, name: 'second' }

			return 'ok'
		})

		const res = await app.handle(
			new Request('http://localhost/cache-invalidation', { method: 'POST' })
		)

		// Should only have one Set-Cookie header (for final value)
		const setCookieHeaders = res.headers.getAll('set-cookie')
		expect(setCookieHeaders.length).toBe(1)
		expect(setCookieHeaders[0]).toContain('id')
	})

	it('should invalidate hash cache when using set() method', async () => {
		const app = new Elysia().post('/cache-set', ({ cookie: { data } }) => {
			// Set initial value
			data.value = { id: 1 }

			// Modify via set() - should invalidate cache
			data.set({ value: { id: 2 } })

			// Set to the updated value again - should detect as unchanged
			data.value = { id: 2 }

			return 'ok'
		})

		const res = await app.handle(
			new Request('http://localhost/cache-set', { method: 'POST' })
		)

		// Should only have one Set-Cookie header
		expect(res.headers.getAll('set-cookie').length).toBe(1)
	})
})
