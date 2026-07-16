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

	it('applies set.headers to a returned Response without mutating it', async () => {
		let original: Response | undefined

		const app = new Elysia().get('/', ({ set }) => {
			set.headers['x-powered-by'] = 'Elysia'

			return (original = new Response('Hi', {
				headers: { 'content-length': '2' }
			}))
		})

		const res = await app.handle(req('/'))

		expect(res).not.toBe(original!)
		expect(res.headers.get('x-powered-by')).toBe('Elysia')
		expect(res.headers.get('content-length')).toBe('2')
		await expect(res.text()).resolves.toBe('Hi')

		expect(original!.headers.get('x-powered-by')).toBeNull()
	})

	it('does not leak set.headers across requests sharing a Response', async () => {
		const shared = new Response('x')

		const app = new Elysia()
			.get('/a', ({ set }) => {
				set.headers['x-req'] = 'A'
				return shared
			})
			.get('/b', ({ set }) => {
				set.headers['x-req'] = 'B'
				return shared
			})

		const a = await app.handle(req('/a'))
		const b = await app.handle(req('/b'))

		expect(a.headers.get('x-req')).toBe('A')
		expect(b.headers.get('x-req')).toBe('B')

		expect(shared.headers.get('x-req')).toBeNull()
		expect(a).not.toBe(shared)
		expect(b).not.toBe(shared)
	})

	it('preserves statusText when Response is rebuilt due to set.headers', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers['x-extra'] = '1'
			return new Response('x', {
				status: 201,
				statusText: 'Created Custom'
			})
		})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(201)
		expect(res.statusText).toBe('Created Custom')
		expect(res.headers.get('x-extra')).toBe('1')
		await expect(res.text()).resolves.toBe('x')
	})

	it('add status to Response', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.status = 401

			return 'Hi'
		})

		const res = await app.handle(req('/'))

		await expect(res.text()).resolves.toBe('Hi')
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

	it('merges default headers with per-request headers and overrides on collision', async () => {
		const app = new Elysia()
			.headers({
				'x-powered-by': 'Elysia',
				'x-frame-options': 'DENY'
			})
			.get('/', ({ set }) => {
				set.headers['x-request-id'] = 'abc'
				set.headers['x-powered-by'] = 'Custom'
				return 'hi'
			})

		const first = await app.handle(req('/')).then((x) => x.headers)
		expect(first.get('x-powered-by')).toBe('Custom')
		expect(first.get('x-frame-options')).toBe('DENY')
		expect(first.get('x-request-id')).toBe('abc')

		const repeated = await app.handle(req('/')).then((x) => x.headers)
		expect(repeated.get('x-powered-by')).toBe('Custom')
		expect(repeated.get('x-frame-options')).toBe('DENY')

		const plainApp = new Elysia()
			.headers({ 'x-powered-by': 'Elysia' })
			.get('/', () => 'hi')
		await plainApp.handle(req('/'))
		const pristine = await plainApp.handle(req('/')).then((x) => x.headers)
		expect(pristine.get('x-powered-by')).toBe('Elysia')
	})

	it('inherits headers from a plugin', async () => {
		const plugin = new Elysia().headers({
			'x-powered-by': 'Elysia'
		})

		const app = new Elysia().use(plugin).get('/', () => 'hi')

		const headers = await app.handle(req('/')).then((x) => x.headers)

		expect(headers.get('x-powered-by')).toBe('Elysia')
	})
})
