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

	it('preserve status and headers for Array subclass responses', async () => {
		class Rows extends Array {}
		const rows = Rows.from([{ id: 1, name: 'elysia' }])

		const app = new Elysia()
			.onRequest(({ set }) => {
				set.headers['x-request-header'] = 'kept'
			})
			.get('/subclass', ({ set }) => {
				set.status = 201
				set.headers['x-custom'] = 'custom-val'
				return rows
			})

		const res = await app.handle(req('/subclass'))

		expect(res.status).toBe(201)
		expect(res.headers.get('x-custom')).toBe('custom-val')
		expect(res.headers.get('x-request-header')).toBe('kept')
		expect(await res.json()).toEqual([{ id: 1, name: 'elysia' }])
	})
})

