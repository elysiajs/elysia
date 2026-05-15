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
			.onTransform(({ set }) => {
				set.headers['x-powered-by'] = 'Elysia'
			})
			.get('/', () => 'Hi')
		const res = await app.handle(req('/'))

		expect(res.headers.get('x-powered-by')).toBe('Elysia')
	})

	it('add headers from plugin', async () => {
		const plugin = (app: Elysia) =>
			app.onTransform(({ set }) => {
				set.headers['x-powered-by'] = 'Elysia'
			})

		const app = new Elysia().use(plugin).get('/', () => 'Hi')
		const res = await app.handle(req('/'))

		expect(res.headers.get('x-powered-by')).toBe('Elysia')
	})

	it('add headers to Response', async () => {
		const app = new Elysia()
			.onTransform(({ set }) => {
				set.headers['x-powered-by'] = 'Elysia'
			})
			.get('/', () => new Response('Hi'))
		const res = await app.handle(req('/'))

		expect(res.headers.get('x-powered-by')).toBe('Elysia')
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

	it('treat headers as case-insensitive', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers['Content-Type'] = 'text/html'

			return '<h1>Hi</h1>'
		})

		const res = await app.handle(req('/'))

		expect(res.headers.get('content-type')).toBe('text/html')
	})

	it('merge mixed-case header keys into one', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers['X-Custom'] = 'first'
			set.headers['x-custom'] = 'second'

			return 'Hi'
		})

		const res = await app.handle(req('/'))

		expect(res.headers.get('x-custom')).toBe('second')
	})

	it('support in operator for case-insensitive headers', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers['content-type'] = 'text/plain'

			return String('Content-Type' in set.headers)
		})

		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('true')
	})

	it('normalize static headers to lowercase', async () => {
		const app = new Elysia()
			.headers({
				'X-Powered-By': 'Elysia'
			})
			.get('/', () => 'hi')

		const res = await app.handle(req('/'))

		expect(res.headers.get('x-powered-by')).toBe('Elysia')
	})
})
