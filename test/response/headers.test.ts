import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Response Headers', () => {
	it('add response headers', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers['x-powered-by'] = 'Elysia'

			return 'Hi'
		})
		const res = await app.handle(req('/'))

		expect(res.headers.get('x-powered-by')).toBe('Elysia')
	})

	it('add headers from hook', async () => {
		const app = new Elysia()
			.transform(({ set }) => {
				set.headers['x-powered-by'] = 'Elysia'
			})
			.get('/', () => 'Hi')
		const res = await app.handle(req('/'))

		expect(res.headers.get('x-powered-by')).toBe('Elysia')
	})

	it('add headers from plugin', async () => {
		const plugin = (app: Elysia) =>
			app.transform(({ set }) => {
				set.headers['x-powered-by'] = 'Elysia'
			})

		const app = new Elysia().use(plugin).get('/', () => 'Hi')
		const res = await app.handle(req('/'))

		expect(res.headers.get('x-powered-by')).toBe('Elysia')
	})

	it('add headers to Response', async () => {
		const app = new Elysia()
			.transform(({ set }) => {
				set.headers['x-powered-by'] = 'Elysia'
			})
			.get('/', () => new Response('Hi'))
		const res = await app.handle(req('/'))

		expect(res.headers.get('x-powered-by')).toBe('Elysia')
	})

	// F28: on Bun a returned Response with a touched set keeps its identity —
	// headers are merged in place instead of rewrapping via response.body,
	// preserving the static in-memory body and its content-length
	it('add headers to Response in place without rewrapping', async () => {
		let original: Response | undefined

		const app = new Elysia().get('/', ({ set }) => {
			set.headers['x-powered-by'] = 'Elysia'

			return (original = new Response('Hi', {
				headers: { 'content-length': '2' }
			}))
		})

		const res = await app.handle(req('/'))

		expect(res).toBe(original!)
		expect(res.headers.get('x-powered-by')).toBe('Elysia')
		expect(res.headers.get('content-length')).toBe('2')
		expect(await res.text()).toBe('Hi')
	})

	it('add status to Response', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.status = 401

			return 'Hi'
		})

		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('Hi')
		expect(res.status).toBe(401)
	})

	it('create static header', async () => {
		const app = new Elysia()
			.headers({
				'x-powered-by': 'Elysia'
			})
			.get('/', () => 'hi')

		const headers = await app.handle(req('/')).then((x) => x.headers)

		expect(headers.get('x-powered-by')).toBe('Elysia')
	})

	it('accept header from plugin', async () => {
		const plugin = new Elysia().headers({
			'x-powered-by': 'Elysia'
		})

		const app = new Elysia().use(plugin).get('/', () => 'hi')

		const headers = await app.handle(req('/')).then((x) => x.headers)

		expect(headers.get('x-powered-by')).toBe('Elysia')
	})
})
