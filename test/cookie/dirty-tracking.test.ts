import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'

const jsonCookie = (name: string, value: unknown) =>
	`${name}=${encodeURIComponent(JSON.stringify(value))}`

// M22: dirtiness is decided at serialize time against the raw parse string,
// so in-place mutation of an object cookie (which never assigns `.value`)
// must still emit Set-Cookie — silently dropping the write is data loss.
describe('Cookie - serialize-time dirty tracking', () => {
	it('emits Set-Cookie for pure in-place mutation', async () => {
		const app = new Elysia().post('/bump', ({ cookie: { data } }) => {
			;(data.value as { count: number }).count++
			return 'ok'
		})

		const res = await app.handle(
			new Request('http://localhost/bump', {
				method: 'POST',
				headers: { cookie: jsonCookie('data', { count: 1 }) }
			})
		)

		const header = res.headers.get('set-cookie')
		expect(header).toBeTruthy()
		expect(decodeURIComponent(header!)).toContain('{"count":2}')
	})

	it('emits Set-Cookie for mutate-and-reassign of the same reference', async () => {
		const app = new Elysia().post('/bump', ({ cookie: { data } }) => {
			const v = data.value as { count: number }
			v.count++
			data.value = v
			return 'ok'
		})

		const res = await app.handle(
			new Request('http://localhost/bump', {
				method: 'POST',
				headers: { cookie: jsonCookie('data', { count: 1 }) }
			})
		)

		expect(decodeURIComponent(res.headers.get('set-cookie')!)).toContain(
			'{"count":2}'
		)
	})

	it('does not emit for read-only access to an object cookie', async () => {
		const app = new Elysia().get(
			'/read',
			({ cookie: { data } }) => (data.value as { count: number }).count
		)

		const res = await app.handle(
			new Request('http://localhost/read', {
				headers: { cookie: jsonCookie('data', { count: 5 }) }
			})
		)

		expect(res.headers.getAll('set-cookie').length).toBe(0)
		expect(await res.text()).toBe('5')
	})

	// attribute changes don't alter the value, so the raw-string dirty check
	// must not swallow them
	it('emits when only a cookie attribute changes on an unchanged value', async () => {
		const app = new Elysia().get('/attr', ({ cookie: { data } }) => {
			data.path = '/x'
			return 'ok'
		})

		const res = await app.handle(
			new Request('http://localhost/attr', {
				headers: { cookie: jsonCookie('data', { k: 1 }) }
			})
		)

		expect(res.headers.get('set-cookie')).toContain('Path=/x')
	})

	// M23: a bare/malformed % must fall back to the raw string instead of
	// silently becoming undefined (data loss)
	it('falls back to the raw string on malformed percent-encoding', async () => {
		const app = new Elysia().get(
			'/m',
			({ cookie: { v } }) => v.value ?? 'MISSING'
		)

		const res = await app.handle(
			new Request('http://localhost/m', {
				headers: { cookie: 'v=100%' }
			})
		)

		expect(await res.text()).toBe('100%')
	})
})
