import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { compileHandler } from '../../src/compile'
import { req, post } from '../utils'

/**
 * Response-map emission harness (F9 + F19).
 *
 * F19 — a body-bearing route used to materialize ALL request headers via
 * `c.request.headers.toJSON()` just to read `content-type` once. The parse
 * codegen already reads `c.request.headers.get('content-type')` directly when
 * `!hasHeaders`, so the materialization is pure waste unless something actually
 * reads `c.headers` (handler/parser/lifecycle fn → `inference.headers`, or a
 * `headers` schema → `vali.headers`).
 *
 * F9 — `hasSet` over-included `hasHeaders`, routing set-untouched responses
 * through the `rm`/handleSet slow path. Reading request headers is a READ; it
 * can never write `c.set`, so such routes take the compact `rc` path. Routes
 * that DO write set (cookie jar, app default headers, response validation,
 * afterResponse/error/trace set.status writeback) stay on `rm`.
 *
 * Codegen is runtime-only — the type gate cannot catch emission bugs, so these
 * assertions inspect the COMPILED FUNCTION source (`fn.toString()`) and also
 * round-trip behaviour through `app.handle`.
 */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const compileRoute = (app: any, index = 0) => {
	const route = (app as Elysia).history![index]
	const fn = compileHandler(route as any, app)
	return { fn, name: fn.constructor.name, source: fn.toString() }
}

describe('F19: body route no longer materializes all headers for content-type', () => {
	it('POST echo body reads content-type directly (no toJSON) and uses rc', () => {
		const app = new Elysia().post('/echo', ({ body }) => body)

		const { source } = compileRoute(app)

		// the parse prologue reads content-type straight off the request
		expect(source).toContain("c.request.headers.get('content-type')")
		// default parsing can fast-path JSON without materializing parser-only
		// context state when no custom parser can observe it
		expect(source).toContain('ct.charCodeAt(12)===106')
		expect(source).not.toContain('c.contentType=ct')
		// no full-header materialization
		expect(source).not.toContain('c.headers=')
		expect(source).not.toContain('.toJSON()')
		// F9 consequence: untouched-set body route uses the compact map
		expect(source).toContain('rc(_r,c.request)')
		expect(source).not.toContain('rm(')
	})

	it('POST echo body still parses correctly', async () => {
		const app = new Elysia().post('/echo', ({ body }) => body)
		const res = await app.handle(post('/echo', { name: 'saltyaom' }))
		await expect(res.json()).resolves.toEqual({ name: 'saltyaom' })
	})

	it('POST with body schema reads content-type directly and validates', async () => {
		const app = new Elysia().post(
			'/echo',
			{
				body: t.Object({ name: t.String() })
			},
			({ body }) => body
		)

		const { source } = compileRoute(app)
		expect(source).toContain("c.request.headers.get('content-type')")
		expect(source).toContain('ct.charCodeAt(12)===106')
		expect(source).not.toContain('c.contentType=ct')
		expect(source).not.toContain('c.headers=')

		const ok = await app.handle(post('/echo', { name: 'x' }))
		await expect(ok.json()).resolves.toEqual({ name: 'x' })

		const bad = await app.handle(post('/echo', { name: 1 }))
		expect(bad.status).toBe(422)
	})

	// A handler that READS c.headers still materializes them (inference.headers)
	it('handler reading c.headers still materializes headers but uses rc', async () => {
		const app = new Elysia().post(
			'/h',
			({ headers }) => headers['x-foo'] ?? 'none'
		)

		const { source } = compileRoute(app)
		// materialization is preserved because the handler reads c.headers
		expect(source).toContain('c.headers=')
		// but it still cannot write set → compact path
		expect(source).toContain('rc(')
		expect(source).not.toContain('rm(')

		const res = await app.handle(
			req('/h', { method: 'POST', headers: { 'x-foo': 'bar' } })
		)
		await expect(res.text()).resolves.toBe('bar')
	})

	// A custom parser reading ctx.headers must still materialize (sucrose sets
	// inference.headers from the parser fn source)
	it('parser reading ctx.headers still materializes headers', () => {
		const app = new Elysia().post(
			'/p',
			{
				parse(c) {
					return (c.headers as any)['x-custom'] ? 'hi' : undefined
				}
			},
			({ body }) => body
		)

		const { source } = compileRoute(app)
		expect(source).toContain('c.headers=')
		expect(source).toContain("c.headers['content-type']")
	})

	it('custom parser still receives parser-only contentType context', async () => {
		let seen: string | undefined
		const app = new Elysia().post(
			'/p',
			{
				parse({ contentType, request }) {
					seen = contentType
					if (contentType === 'application/json') return request.json()
				}
			},
			({ body }) => body
		)

		const { source } = compileRoute(app)
		expect(source).toContain('c.contentType=ct')

		const res = await app.handle(
			req('/p', {
				method: 'POST',
				headers: { 'content-type': 'application/json; charset=utf-8' },
				body: JSON.stringify({ name: 'saltyaom' })
			})
		)

		expect(seen).toBe('application/json')
		await expect(res.json()).resolves.toEqual({ name: 'saltyaom' })
	})

	// A headers SCHEMA must still materialize (vali.headers)
	it('headers schema still materializes headers', () => {
		const app = new Elysia().post(
			'/hs',
			{
				headers: t.Object({ 'x-foo': t.String() })
			},
			({ body }) => body
		)

		const { source } = compileRoute(app)
		expect(source).toContain('c.headers=')
		expect(source).toContain("va.headers.From(c.headers,'headers')")
	})
})

describe('F9: hasHeaders is not a hasSet term', () => {
	it('GET reading c.headers uses the compact rc path', async () => {
		const app = new Elysia().get(
			'/h',
			({ headers }) => headers['x-foo'] ?? ''
		)

		const { source } = compileRoute(app)
		// reads headers → materialized
		expect(source).toContain('c.headers=')
		// but cannot write set → rc, no c.set in the map call
		expect(source).toContain('rc(_r,c.request)')
		expect(source).not.toContain('c.set')

		const res = await app.handle(req('/h', { headers: { 'x-foo': 'baz' } }))
		await expect(res.text()).resolves.toBe('baz')
	})

	it('a route that writes c.set stays set-aware', async () => {
		const app = new Elysia().get('/s', ({ set }) => {
			set.headers['x-y'] = 'z'
			return 'hi'
		})

		const { source } = compileRoute(app)
		// inference.set → the set-aware map receives c.set, whether emitted as
		// codegen `rm(_r,c.set,c.request)` or — for a plain sync handler that
		// takes the no-eval inline path — `createInlineHandlerWithSet`'s
		// `map(r, c.set, c.request)`. Either way c.set is passed; never the
		// compact rc (which would drop the write).
		expect(source).toContain('c.set')
		// behaviour: the write reaches the response
		const res = await app.handle(req('/s'))
		expect(res.headers.get('x-y')).toBe('z')
	})

	it('a route with app default headers stays set-aware', async () => {
		const app = new Elysia()
			.headers({ 'x-app': 'default' })
			.get('/d', () => 'hi')

		const { source } = compileRoute(app)
		expect(source).toContain('c.set')
		const res = await app.handle(req('/d'))
		expect(res.headers.get('x-app')).toBe('default')
	})

	// status writeback must still work: an afterResponse route keeps hasSet (and
	// the rm map, here inside the `_fin2` helper) so afterResponse observes the
	// written-back set.status === 418. This is the load-bearing reason
	// hasAfterResponse must stay in hasSet even though F9 dropped hasHeaders.
	it('status() + afterResponse: set.status writeback is observed (rm retained)', async () => {
		let observed: unknown
		const app = new Elysia()
			.afterResponse(({ set }) => {
				observed = set.status
			})
			.get('/st', ({ status }) => status(418))

		const res = await app.handle(req('/st'))
		expect(res.status).toBe(418)
		await new Promise((r) => setTimeout(r, 10))
		expect(observed).toBe(418)
	})

	// A set-writing route keeps hasSet → the set-aware map (passing c.set), while
	// a header-only-reading sibling does NOT (compact rc) — proving hasHeaders is
	// not a hasSet term. The set-writer is a plain sync handler so it takes the
	// no-eval inline path (createInlineHandlerWithSet); the header-reader
	// materializes headers (inlineUnsafe) so it stays on codegen and emits rc.
	it('writeback-bearing route is set-aware; header-read route uses compact rc', async () => {
		const writes = new Elysia().get('/w', ({ set }) => {
			set.status = 418
			return 'hi'
		})
		const reads = new Elysia().get(
			'/r',
			({ headers }) => headers['x-foo'] ?? ''
		)

		expect(compileRoute(writes).source).toContain('c.set')
		await expect(
			writes.handle(req('/w')).then((r) => r.status)
		).resolves.toBe(418)
		expect(compileRoute(reads).source).toContain('rc(_r,c.request)')
	})
})
