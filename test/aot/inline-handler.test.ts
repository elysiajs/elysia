import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { compileHandler } from '../../src/compile'
import { req } from '../utils'

/**
 * Inline handler fast path.
 *
 * A handler whose only emitted logic is "call h, map the result" is compiled to
 * a plain closure (createInlineHandler / …WithSet) instead of a `new Function`
 * eval. An async handler already qualified (alias 'rc'/'rm'); a SYNC handler
 * additionally links `forwardError` ('fe'), giving alias 'rc,fe'/'rm,fe' and a
 * params.size of 2 — which used to push it onto the eval path. createInlineHandler
 * performs the same Error-throw + Promise + forwardError handling, so the plain
 * sync handler is inline-eligible too.
 *
 * These tests pin (a) that the plain sync handler actually inlines and (b) that
 * the inline path preserves the `fe`/forwardError semantics it replaced — using
 * a codegen-forced sibling (a header read sets inlineUnsafe) as the oracle.
 */

const source = (app: any, i = 0) =>
	compileHandler((app as Elysia).history![i] as any, app).toString()

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

	it('a header-reading route stays on codegen (inlineUnsafe)', () => {
		const app = new Elysia().get('/', ({ headers }) => headers['x'] ?? 'ok')
		expect(source(app)).not.toContain('forwardError')
	})

	// Behaviour parity with the codegen path (oracle = a header-read sibling that
	// is forced onto codegen). A returned Error must forward like a throw.
	it('forwards a RETURNED Error like a throw — inline matches codegen', async () => {
		const inline = new Elysia().get('/', () => new Error('boom'))
		const codegen = new Elysia().get('/', ({ headers }) =>
			headers['x'] ? 'x' : new Error('boom')
		)

		const ri = await inline.handle(req('/'))
		const rc = await codegen.handle(req('/'))

		expect(ri.status).toBe(500)
		// generic 500 → problem+json; inline path must match codegen byte-for-byte
		const bi = await ri.json()
		expect(bi).toMatchObject({
			type: 'unknown',
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
			type: 'unknown',
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
