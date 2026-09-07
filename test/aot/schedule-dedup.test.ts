import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia } from '../../src'
import { trace } from '../../src/plugin/trace'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { compileHandler } from '../../src/compile/handler'

/** Scheduled after-response work is emitted once and still runs once. */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const compileRoute = (app: any, index = 0) => {
	const route = (app as Elysia)['~routes']![index]
	const fn = compileHandler(route as any, app)
	return { fn, source: fn.toString() }
}

const count = (haystack: string, needle: string) =>
	haystack.split(needle).length - 1

describe('schedule block emission', () => {
	it('shares one schedule block across trace and error paths', () => {
		const app = new Elysia()
			.use(trace())
			.trace(() => {})
			.get(
				'/',
				{
					error: [() => {}, () => {}, () => {}]
				},
				() => 'hi'
			)

		const { source } = compileRoute(app)

		// the schedule block body (queueMicrotask closure) appears exactly once
		expect(count(source, 'function _sc(){')).toBe(1)
		expect(count(source, 'queueMicrotask(async()=>{')).toBe(1)

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
		expect(count(source, 'queueMicrotask(async()=>{')).toBe(1)
		expect(count(source, 'function _sc(){')).toBe(1)
	})
})

describe('scheduled afterResponse behavior', () => {
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

		const res = await app.handle('/')
		await expect(res.text()).resolves.toBe('ok')
		await new Promise((r) => setTimeout(r, 10))
		expect(calls).toBe(1)
	})

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

		const res = await app.handle('/')
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
				// Undefined error hooks fall through to the default message.
				error() {}
			},
			async () => {
				throw new Error('unhandled')
			}
		)

		const res = await app.handle('/')
		expect(res.status).toBe(500)
		await new Promise((r) => setTimeout(r, 10))
		expect(calls).toBe(1)
	})

	it('keeps inline scheduling when a sync route only has afterResponse', () => {
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
