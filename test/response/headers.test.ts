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

	// Regression: Array subclass responses (e.g. postgres.js RowList, Bun.sql
	// results) silently dropped all middleware-set headers because the
	// constructor.name check missed them and the default fallback called
	// Response.json() / new Response() without passing `set`.
	// See: https://github.com/elysiajs/elysia/issues/1656
	it('preserve headers when handler returns Array subclass', async () => {
		class CustomArray<T> extends Array<T> {
			command = 'SELECT'
			count = 2
		}

		const result = new CustomArray()
		result.push({ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' })

		const app = new Elysia()
			.onTransform(({ set }) => {
				set.headers['x-powered-by'] = 'Elysia'
				set.headers['access-control-allow-origin'] = '*'
			})
			.get('/', () => result)

		const res = await app.handle(req('/'))

		expect(res.headers.get('x-powered-by')).toBe('Elysia')
		expect(res.headers.get('access-control-allow-origin')).toBe('*')
		expect(res.headers.get('content-type')).toContain('application/json')
		expect(await res.json()).toEqual([
			{ id: 1, name: 'Alice' },
			{ id: 2, name: 'Bob' }
		])
	})

	it('preserve status when handler returns Array subclass', async () => {
		class RowList<T> extends Array<T> {}
		const result = new RowList()
		result.push({ ok: true })

		const app = new Elysia().get('/', ({ set }) => {
			set.status = 201
			return result
		})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(201)
		expect(await res.json()).toEqual([{ ok: true }])
	})
})
