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

	// a returned Response must NOT be mutated in place. Elysia rebuilds it
	// into a fresh Response so a shared/module-level Response cannot carry one
	// request's `set.headers` onto a later response. The static in-memory body
	// and its content-length must survive the rebuild.
	it('applies set.headers to a returned Response without mutating it', async () => {
		let original: Response | undefined

		const app = new Elysia().get('/', ({ set }) => {
			set.headers['x-powered-by'] = 'Elysia'

			return (original = new Response('Hi', {
				headers: { 'content-length': '2' }
			}))
		})

		const res = await app.handle(req('/'))

		// rebuilt, not the same object — otherwise set.headers leak onto it
		expect(res).not.toBe(original!)
		expect(res.headers.get('x-powered-by')).toBe('Elysia')
		expect(res.headers.get('content-length')).toBe('2')
		await expect(res.text()).resolves.toBe('Hi')

		// the original object the handler returned must stay untouched
		expect(original!.headers.get('x-powered-by')).toBeNull()
	})

	//  regression: two routes returning the SAME module-level Response with
	// different per-request set.headers must not contaminate each other, and
	// the shared object must never be mutated. Before the fix, the Bun fast
	// path mutated response.headers in place, so request B saw request A's
	// header and the shared object was permanently polluted.
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

		// the shared module-level Response must remain unmodified
		expect(shared.headers.get('x-req')).toBeNull()
		expect(a).not.toBe(shared)
		expect(b).not.toBe(shared)
	})

	// when a handler returns a Response with a custom statusText AND
	// set.headers is non-empty (forcing a rebuild), the rebuild must carry
	// statusText through. Before the fix, `new Response(body, initWithoutStatusText)`
	// dropped it, so `res.statusText` became '' even though the handler set it.
	it('preserves statusText when Response is rebuilt due to set.headers', async () => {
		const app = new Elysia()
			.get('/', ({ set }) => {
				set.headers['x-extra'] = '1'
				return new Response('x', { status: 201, statusText: 'Created Custom' })
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

	// adapter-2: default headers are now cloned as own props at context
	// construction (no prototype link), so `handleSet` no longer flattens the
	// proto chain each request. This pins that the merge is unchanged: default
	// headers and per-request headers both emit, a per-request write overrides a
	// default on the same key, and defaults survive across requests.
	it('merges default headers with per-request headers and overrides on collision', async () => {
		const app = new Elysia()
			.headers({
				'x-powered-by': 'Elysia',
				'x-frame-options': 'DENY'
			})
			.get('/', ({ set }) => {
				// a fresh per-request header
				set.headers['x-request-id'] = 'abc'
				// overrides a default on the same key
				set.headers['x-powered-by'] = 'Custom'
				return 'hi'
			})

		const first = await app.handle(req('/')).then((x) => x.headers)
		expect(first.get('x-powered-by')).toBe('Custom') // per-request wins
		expect(first.get('x-frame-options')).toBe('DENY') // default survives
		expect(first.get('x-request-id')).toBe('abc') // per-request added

		// defaults must not be mutated by the previous request's override
		const second = await app
			.handle(req('/second'))
			.catch(() => null)
		void second
		const untouched = await app
			.handle(req('/'))
			.then((x) => x.headers)
		expect(untouched.get('x-powered-by')).toBe('Custom')
		expect(untouched.get('x-frame-options')).toBe('DENY')

		// a request that does NOT override still sees the pristine default
		const plainApp = new Elysia()
			.headers({ 'x-powered-by': 'Elysia' })
			.get('/', () => 'hi')
		await plainApp.handle(req('/'))
		const pristine = await plainApp.handle(req('/')).then((x) => x.headers)
		expect(pristine.get('x-powered-by')).toBe('Elysia')
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
