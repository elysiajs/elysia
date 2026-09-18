import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { compileHandler } from '../../src/compile/handler'

/** Inline handlers avoid new Function without changing error or Promise behavior. */

const source = (app: any, i = 0) =>
	compileHandler((app as Elysia)['~routes']![i] as any, app).toString()

describe('inline handler fast path (no new Function eval)', () => {
	it('a plain sync GET takes the inline closure path', () => {
		const app = new Elysia().get('/', () => 'ok')
		const s = source(app)
		// the inline closure captures `forwardError` directly; the codegen path
		// would reference the linked `fe` alias inside a `function route` body.
		expect(s).toContain('forwardError')
		expect(s).not.toContain('function route')
	})

	it('a plain sync set-writing GET takes the inline set-aware path', () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.status = 201
			return 'ok'
		})
		const s = source(app)
		expect(s).toContain('forwardError')
		expect(s).toContain('c.set')
	})

	it('default headers keep a set-writing GET on the inline path', () => {
		const app = new Elysia()
			.headers({ 'x-default': 'base' })
			.get('/', ({ set }) => {
				set.status = 201
				return 'ok'
			})
		const s = source(app)
		expect(s).toContain('materializeSetHeaders')
		expect(s).not.toContain('function route')
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

		const ri = await inline.handle('/')
		const rc = await codegen.handle('/')

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
		const res = await app.handle('/')
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
		const res = await app.handle('/')
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('async-ok')
	})

	it('a returned Error reaches an error hook (set.status writeback intact)', async () => {
		const app = new Elysia()
			.error(({ error, set }) => {
				set.status = 418
				return 'caught:' + (error as Error).message
			})
			.get('/', () => new Error('boom'))

		const res = await app.handle('/')
		expect(res.status).toBe(418)
		await expect(res.text()).resolves.toBe('caught:boom')
	})
})
