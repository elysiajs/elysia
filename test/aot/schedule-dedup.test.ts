import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { compileHandler } from '../../src/compile'
import { req } from '../utils'

/**
 * Schedule-block dedup harness (F10).
 *
 * The afterResponse/trace SCHEDULE block (`c._arf=true` + `setImmediate(async
 * () => { ... drain ... afterResponse spans ... })`) used to be concatenated
 * verbatim at the success return, once per error hook inside the catch, and in
 * the catch fallbacks — up to 5 identical copies in a single function, all
 * parsed/JIT'd, only one ever running. F10 hoists it into one route-local
 * `function _sc(){...}` declared before the route `try{`, and replaces every
 * site with a `_sc()` call.
 *
 * Codegen is runtime-only — these assertions count emission occurrences in the
 * compiled source and round-trip behaviour (the scheduled afterResponse/trace
 * hooks still fire exactly once on each return path).
 */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const compileRoute = (app: any, index = 0) => {
	const route = (app as Elysia).history![index]
	const fn = compileHandler(route as any, app)
	return { fn, source: fn.toString() }
}

const count = (haystack: string, needle: string) =>
	haystack.split(needle).length - 1

describe('F10: schedule block is emitted once on trace+error routes', () => {
	it('trace + 3 error hooks: one `function _sc(){` decl, multiple `_sc()` calls', () => {
		const app = new Elysia()
			.trace(() => {})
			.get(
				'/',
				{
					error: [() => {}, () => {}, () => {}]
				},
				() => 'hi'
			)

		const { source } = compileRoute(app)

		// the schedule block body (setImmediate closure) appears exactly once
		expect(count(source, 'function _sc(){')).toBe(1)
		expect(count(source, 'setImmediate(async()=>{')).toBe(1)

		// it is called at every return path: success + 3 error hooks + fallback
		expect(count(source, '_sc()')).toBeGreaterThanOrEqual(5)

		// the declaration is positioned before the route `try{`
		expect(source.indexOf('function _sc(){')).toBeLessThan(
			source.indexOf('try{')
		)
	})

	it('afterResponse + 2 error hooks: schedule block deduped (no trace)', () => {
		// async route (the handler is async so the route stays an AsyncFunction
		// and afterResponse does not take the syncAfterResponse `_fin2` path)
		const app = new Elysia().get(
			'/',
			{
				afterResponse() {},
				error: [() => {}, () => {}]
			},
			async () => 'hi'
		)

		const { source } = compileRoute(app)
		expect(count(source, 'setImmediate(async()=>{')).toBe(1)
		expect(count(source, 'function _sc(){')).toBe(1)
	})
})

describe('F10: behaviour preserved', () => {
	it('afterResponse fires once on the success path with an error hook present', async () => {
		let calls = 0
		const app = new Elysia().get(
			'/',
			{
				afterResponse() {
					calls++
				},
				error() {}
			},
			async () => 'ok'
		)

		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('ok')
		await new Promise((r) => setTimeout(r, 10))
		expect(calls).toBe(1)
	})

	// The handler is async so the route is an AsyncFunction (isAsync), the catch
	// is inlined (not the `_ce` factory helper), and the deduped `_sc()` is the
	// path exercised on every error return. (A SYNC handler + error hook + sync
	// afterResponse is a separate, pre-existing Wave-3a codegen combination that
	// F10 deliberately does not touch — the `syncErrorHook` gate keeps it inline.)
	it('afterResponse fires once when an error hook handles a throw', async () => {
		let calls = 0
		const app = new Elysia().get(
			'/',
			{
				afterResponse() {
					calls++
				},
				error({ set }) {
					set.status = 418
					return 'handled'
				}
			},
			async () => {
				throw new Error('boom')
			}
		)

		const { source } = compileRoute(app)
		expect(source).toContain('function _sc(){')

		const res = await app.handle(req('/'))
		expect(res.status).toBe(418)
		await expect(res.text()).resolves.toBe('handled')
		await new Promise((r) => setTimeout(r, 10))
		expect(calls).toBe(1)
	})

	it('afterResponse fires once on the unhandled-error fallback path', async () => {
		let calls = 0
		const app = new Elysia().get(
			'/',
			{
				afterResponse() {
					calls++
				},
				// error hook returns undefined → falls through to the message
				// fallback path
				error() {}
			},
			async () => {
				throw new Error('unhandled')
			}
		)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(500)
		await new Promise((r) => setTimeout(r, 10))
		expect(calls).toBe(1)
	})

	// The syncAfterResponse `_fin2` factory path (sync route, afterResponse, NO
	// error hook, NO trace) must KEEP its inline schedule — it lives in a factory
	// helper that cannot see a route-local `_sc`.
	it('syncAfterResponse path keeps inline schedule (no _sc helper)', () => {
		const app = new Elysia().get(
			'/',
			{
				afterResponse() {}
			},
			() => 'hi'
		)

		const { source } = compileRoute(app)
		// route function source does not declare `_sc` (the schedule lives in the
		// `_fin2` factory helper, outside this function's source)
		expect(source).not.toContain('function _sc(){')
	})
})
