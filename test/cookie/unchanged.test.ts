import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'

describe('unchanged cookie values', () => {
	it('does not emit Set-Cookie when a parsed object cookie is only read', async () => {
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

		const postResponse = await app.handle(
			new Request('http://localhost/cookie', {
				method: 'POST'
			})
		)

		const setCookieHeaders = postResponse.headers.getAll('set-cookie')
		expect(setCookieHeaders.length).toBeGreaterThan(0)

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

	it('emits Set-Cookie for writes but not reads', async () => {
		const app = new Elysia()
			.get('/read', ({ cookie: { session } }) => {
				const val = session.value
				return { read: val }
			})
			.get('/write', ({ cookie: { session } }) => {
				session.value = 'test'
				return { written: true }
			})

		const readResponse = await app.handle(
			new Request('http://localhost/read')
		)
		expect(readResponse.headers.getAll('set-cookie').length).toBe(0)

		const writeResponse = await app.handle(
			new Request('http://localhost/write')
		)
		expect(
			writeResponse.headers.getAll('set-cookie').length
		).toBeGreaterThan(0)
	})

	it('emits Set-Cookie when a value changes', async () => {
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

	it('does not emit Set-Cookie for an object equal to the incoming value', async () => {
		const app = new Elysia().post('/update', ({ cookie: { data } }) => {
			data.value = { id: 123, name: 'test' }
			return 'ok'
		})

		const firstRes = await app.handle(
			new Request('http://localhost/update', { method: 'POST' })
		)
		const setCookie = firstRes.headers.get('set-cookie')
		expect(setCookie).toBeTruthy()

		const secondRes = await app.handle(
			new Request('http://localhost/update', {
				method: 'POST',
				headers: {
					cookie: setCookie!.split(';')[0]
				}
			})
		)

		expect(secondRes.headers.getAll('set-cookie').length).toBe(0)
	})

	it('does not emit Set-Cookie for a large unchanged object', async () => {
		const large = {
			users: Array.from({ length: 100 }, (_, i) => ({
				id: i,
				name: `User ${i}`
			}))
		}

		const app = new Elysia().post('/update', ({ cookie: { data } }) => {
			data.value = large
			return 'ok'
		})

		const firstRes = await app.handle(
			new Request('http://localhost/update', { method: 'POST' })
		)
		const setCookie = firstRes.headers.get('set-cookie')
		expect(setCookie).toBeTruthy()

		const secondRes = await app.handle(
			new Request('http://localhost/update', {
				method: 'POST',
				headers: {
					cookie: setCookie!.split(';')[0]
				}
			})
		)

		expect(secondRes.headers.getAll('set-cookie').length).toBe(0)
	})

	it('emits one Set-Cookie for repeated equal assignments', async () => {
		const app = new Elysia().post('/multi', ({ cookie: { data } }) => {
			data.value = { id: 123, name: 'test' }
			data.value = { id: 123, name: 'test' }
			data.value = { id: 123, name: 'test' }
			return 'ok'
		})

		const res = await app.handle(
			new Request('http://localhost/multi', { method: 'POST' })
		)

		expect(res.headers.getAll('set-cookie').length).toBe(1)
	})

	it('invalidates value comparison after update()', async () => {
		const app = new Elysia().post(
			'/cache-invalidation',
			({ cookie: { data } }) => {
				data.value = { id: 1, name: 'first' }

				data.update({ value: { id: 2, name: 'second' } })

				data.value = { id: 2, name: 'second' }

				return 'ok'
			}
		)

		const res = await app.handle(
			new Request('http://localhost/cache-invalidation', {
				method: 'POST'
			})
		)

		const setCookieHeaders = res.headers.getAll('set-cookie')
		expect(setCookieHeaders.length).toBe(1)
		expect(setCookieHeaders[0]).toContain('id')
	})

	it('suppresses equal assignments through separate jar accesses', async () => {
		const app = new Elysia().post('/multi-access', ({ cookie }) => {
			cookie.data.value = { id: 123, name: 'test' }
			cookie.data.value = { id: 123, name: 'test' }

			return 'ok'
		})

		const res = await app.handle(
			new Request('http://localhost/multi-access', { method: 'POST' })
		)

		expect(res.headers.getAll('set-cookie').length).toBe(1)
	})

	it('emits the latest value after multiple writes', async () => {
		const app = new Elysia().post('/rewrite', ({ cookie: { data } }) => {
			data.value = { id: 1 }
			data.value = { id: 2 }

			return 'ok'
		})

		const res = await app.handle(
			new Request('http://localhost/rewrite', { method: 'POST' })
		)

		const headers = res.headers.getAll('set-cookie')
		expect(headers.length).toBe(1)
		expect(decodeURIComponent(headers[0])).toContain('{"id":2}')
	})

	it('invalidates value comparison after set()', async () => {
		const app = new Elysia().post('/cache-set', ({ cookie: { data } }) => {
			data.value = { id: 1 }

			data.set({ value: { id: 2 } })

			data.value = { id: 2 }

			return 'ok'
		})

		const res = await app.handle(
			new Request('http://localhost/cache-set', { method: 'POST' })
		)

		expect(res.headers.getAll('set-cookie').length).toBe(1)
	})
})
