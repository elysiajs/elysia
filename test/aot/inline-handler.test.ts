import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { compileHandler } from '../../src/compile/handler'
import { req } from '../utils'

/** Inline handlers avoid new Function without changing error or Promise behavior. */

const source = (app: any, i = 0) =>
	compileHandler((app as Elysia)['~routes']![i] as any, app).toString()

describe('inline handler fast path (no new Function eval)', () => {
	it('a plain sync GET takes the inline closure path', () => {
		const app = new Elysia().get('/', () => 'ok')
		const s = source(app)
		// Default-mode inline closures are wrapped by the Q12 settlement boundary;
		// codegen would instead expose a `function route` body.
		expect(s).toContain('settle')
		expect(s).not.toContain('function route')
	})

	it('a plain sync set-writing GET takes the inline set-aware path', () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.status = 201
			return 'ok'
		})
		const s = source(app)
		expect(s).toContain('settle')
		expect(s).not.toContain('function route')
	})

	it('default headers keep a set-writing GET on the inline path', async () => {
		const app = new Elysia()
			.headers({ 'x-default': 'base' })
			.get('/', ({ set }) => {
				set.status = 201
				return 'ok'
			})
		const s = source(app)
		expect(s).toContain('settle')
		expect(s).not.toContain('function route')

		const res = await app.handle(req('/'))
		expect(res.status).toBe(201)
		expect(res.headers.get('x-default')).toBe('base')
	})

	it('a header-reading route stays on codegen (inlineUnsafe)', () => {
		const app = new Elysia().get('/', ({ headers }) => headers['x'] ?? 'ok')
		expect(source(app)).not.toContain('forwardError')
	})

	// Compare with a header-reading route forced through code generation.
	it('forwards a returned Error like a throw and matches codegen', async () => {
		const inline = new Elysia().get('/', () => new Error('boom'))
		const codegen = new Elysia().get('/', ({ headers }) =>
			headers['x'] ? 'x' : new Error('boom')
		)

		const ri = await inline.handle(req('/'))
		const rc = await codegen.handle(req('/'))

		expect(ri.status).toBe(500)
		const bi = await ri.json()
		expect(bi).toMatchObject({
			type: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500,
			detail: 'boom'
		})
		expect(rc.status).toBe(ri.status)
		await expect(rc.json()).resolves.toEqual(bi)
	})

	it('forwards a rejecting Promise returned by a sync handler', async () => {
		const app = new Elysia().get('/', () =>
			Promise.reject(new Error('rejected'))
		)
		const res = await app.handle(req('/'))
		expect(res.status).toBe(500)
		await expect(res.json()).resolves.toMatchObject({
			type: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500,
			detail: 'rejected'
		})
	})

	it('resolves a Promise returned by a sync handler to its value', async () => {
		const app = new Elysia().get('/', () => Promise.resolve('async-ok'))
		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('async-ok')
	})

	it('settles a Promise-returning inline mapper at the default cancellation boundary', async () => {
		const controller = new AbortController()
		const app = new Elysia().get('/', () => () => {
			controller.abort()
			return Promise.resolve('mapped')
		})

		expect(source(app)).not.toContain('function route')
		const res = await app.handle(req('/', { signal: controller.signal }))
		await expect(res.text()).resolves.toBe('')
	})

	it('keeps Promise-returning inline mapper settlement legacy-compatible', async () => {
		const controller = new AbortController()
		const app = new Elysia({
			experimental: { cancellation: 'compat' }
		}).get('/', () => () => {
			controller.abort()
			return Promise.resolve('mapped')
		})

		expect(source(app)).toContain('forwardError')
		const res = await app.handle(req('/', { signal: controller.signal }))
		await expect(res.text()).resolves.toBe('mapped')
	})

	it('a returned Error reaches an error hook (set.status writeback intact)', async () => {
		const app = new Elysia()
			.error(({ error, set }) => {
				set.status = 418
				return 'caught:' + (error as Error).message
			})
			.get('/', () => new Error('boom'))

		const res = await app.handle(req('/'))
		expect(res.status).toBe(418)
		await expect(res.text()).resolves.toBe('caught:boom')
	})
})
