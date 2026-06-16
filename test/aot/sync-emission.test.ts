import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import {
	Compiled,
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot'
import { compileHandler } from '../../src/compile'
import { materialise, materialiseHandlers } from './_manifest'
import { req, post } from '../utils'

/**
 * Async-cliff harness (F1/F11/F23/F24/F25/F26/F46).
 *
 * `isAsync` in compileHandler historically triggered on feature PRESENCE, not
 * asyncness, so a route whose every moving part is synchronous still compiled
 * to an `AsyncFunction` — paying an async-function frame + an `await` on a
 * non-promise per request. This harness compiles representative route flavors
 * and asserts on the COMPILED FUNCTION itself: a sync route must be a plain
 * `Function`, an async one must stay `AsyncFunction`. Each flavor also
 * round-trips through `app.handle` so the emission stays behaviourally correct.
 *
 * Codegen is runtime-only — the type gate cannot catch emission bugs, so this
 * file is the net. Assertions inspect `constructor.name` of the route function
 * returned by `compileHandler`. The single-param inline fast-path
 * (`createInlineHandler`) returns a plain arrow regardless, which would mask an
 * async route, so flavors whose async-ness is load-bearing carry enough surface
 * (set read, extra param) to force the `new Function('route')` tail.
 */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

/** Compile the i-th route of `app` and return its function + source. */
const compileRoute = (app: any, index = 0) => {
	const route = (app as Elysia).history![index]
	const fn = compileHandler(route as any, app)
	return { fn, name: fn.constructor.name, source: fn.toString() }
}

const isAsync = (app: any, index = 0) =>
	compileRoute(app, index).name === 'AsyncFunction'

describe('async-cliff: sync routes emit plain Function', () => {
	it('plain sync GET is a plain Function', async () => {
		const app = new Elysia().get('/', () => 'hi')

		expect(isAsync(app)).toBe(false)
		expect(await (await app.handle(req('/'))).text()).toBe('hi')
	})

	it('async handler stays AsyncFunction', async () => {
		// A query schema (sync TypeBox validator) links a 2nd param, forcing the
		// `new Function('route')` tail instead of the single-param inline
		// fast-path (`createInlineHandler`, always a plain arrow) — so the route
		// function's own async-ness is observable.
		const app = new Elysia().get('/', async () => 'hi', {
			query: t.Object({ q: t.Optional(t.String()) })
		})

		expect(isAsync(app)).toBe(true)
		expect(await (await app.handle(req('/?q=1'))).text()).toBe('hi')
	})

	// F23 — error hook
	it('sync GET + sync error hook is a plain Function', async () => {
		const app = new Elysia().error(() => {}).get('/', () => 'hi')

		expect(isAsync(app)).toBe(false)
		expect(await (await app.handle(req('/'))).text()).toBe('hi')
	})

	it('sync GET + async error hook stays AsyncFunction', () => {
		const app = new Elysia().error(async () => {}).get('/', () => 'hi')

		expect(isAsync(app)).toBe(true)
	})

	// F24 — afterResponse
	it('sync GET + sync afterResponse is a plain Function', async () => {
		const app = new Elysia()
			.afterResponse(() => {})
			.get('/', () => 'hi')

		expect(isAsync(app)).toBe(false)
		expect(await (await app.handle(req('/'))).text()).toBe('hi')
	})

	it('sync GET + async afterResponse stays AsyncFunction', () => {
		const app = new Elysia()
			.afterResponse(async () => {})
			.get('/', () => 'hi')

		expect(isAsync(app)).toBe(true)
	})

	// F24 regression — error hook + afterResponse must force async. The error
	// hook disables the sync `_fin` afterResponse path, so the inline `teeBlock`
	// emits a top-level `await tee`; the route MUST be async or that compiles an
	// `await` into a sync function (a SyntaxError swallowed to a 500 on every
	// request to the route). Pins both halves: AsyncFunction emission + behavior.
	it('sync GET + sync error hook + sync afterResponse stays AsyncFunction and serves 200', async () => {
		let fired = false
		const app = new Elysia()
			.error(() => 'mapped-err')
			.afterResponse(() => {
				fired = true
			})
			.get('/', () => 'hi')

		expect(isAsync(app)).toBe(true)

		const ok = await app.handle(req('/'))
		expect(ok.status).toBe(200)
		expect(await ok.text()).toBe('hi')

		await new Promise((r) => setTimeout(r, 10))
		expect(fired).toBe(true)
	})

	it('error hook + afterResponse still maps a thrown error', async () => {
		const app = new Elysia()
			.error(() => 'mapped-err')
			.afterResponse(() => {})
			.get('/', () => {
				throw new Error('boom')
			})

		const r = await app.handle(req('/'))
		expect(r.status).toBe(500)
		expect(await r.text()).toBe('mapped-err')
	})

	// F1 — unsigned cookie
	it('GET reading an unsigned cookie is a plain Function', async () => {
		const app = new Elysia().get('/', ({ cookie }) => {
			cookie.id.value
			return 'hi'
		})

		expect(isAsync(app)).toBe(false)
		expect(
			await (
				await app.handle(req('/', { headers: { cookie: 'id=abc' } }))
			).text()
		).toBe('hi')
	})

	// signed cookie — stays async
	it('GET reading a signed cookie stays AsyncFunction', () => {
		const app = new Elysia({
			cookie: { sign: ['id'], secrets: 'secret' }
		}).get('/', ({ cookie }) => {
			cookie.id.value
			return 'hi'
		})

		expect(isAsync(app)).toBe(true)
	})

	// F26 — sync parse hook on a bodyless GET
	it('app-level sync .parse + bodyless GET is a plain Function', async () => {
		const app = new Elysia().parse(() => {}).get('/', () => 'hi')

		expect(isAsync(app)).toBe(false)
		expect(await (await app.handle(req('/'))).text()).toBe('hi')
	})

	// F26 — bodyless GET/HEAD skips the parse block entirely (method-gated), so
	// even an async parse hook does not drag a bodyless GET onto the async path
	// (the hook simply doesn't fire on a body-less method, matching v1).
	it('app-level async .parse + bodyless GET is a plain Function (parse skipped)', async () => {
		const app = new Elysia().parse(async () => {}).get('/', () => 'hi')

		expect(isAsync(app)).toBe(false)
		expect(await (await app.handle(req('/'))).text()).toBe('hi')
	})

	// F26 — an async parse hook on a POST (real body) still forces async and
	// still runs
	it('async .parse on a POST stays AsyncFunction and runs', async () => {
		let ran = false
		const app = new Elysia()
			.parse(async () => {
				ran = true
				return { ok: 1 }
			})
			.post('/', ({ body }) => body)

		expect(isAsync(app)).toBe(true)
		const res = await app.handle(post('/', { a: 1 }))
		expect(ran).toBe(true)
		expect(await res.json()).toEqual({ ok: 1 })
	})

	// F26 — explicit body schema on a GET still forces parsing (validation runs)
	it('GET with explicit body schema stays AsyncFunction (parse forced)', () => {
		const app = new Elysia().get('/', ({ body }) => body, {
			body: t.Object({ n: t.Number() })
		})

		expect(isAsync(app)).toBe(true)
	})

	// POST body — async (real body read)
	it('POST with t.Object body stays AsyncFunction (body read is async)', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({ n: t.Number() })
		})

		expect(isAsync(app)).toBe(true)
		expect(await (await app.handle(post('/', { n: 5 }))).json()).toEqual({
			n: 5
		})
	})

	// F25 — MultiValidator is strictly sync → sync route
	it('MultiValidator query (sync) is a plain Function', async () => {
		const fakeStd = {
			'~standard': {
				version: 1,
				vendor: 'x',
				validate: (v: any) => ({ value: v })
			}
		}
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({ q: t.Optional(t.String()) }),
			schemas: [fakeStd as any]
		})

		expect(isAsync(app)).toBe(false)
		const res = await app.handle(req('/?q=hi'))
		expect(res.status).toBe(200)
	})

	// F25 — StandardValidator stays conservatively async (its From may return a
	// Promise; no per-request probing yet)
	it('StandardValidator query stays AsyncFunction', () => {
		const fakeStd = {
			'~standard': {
				version: 1,
				vendor: 'x',
				validate: (v: any) => ({ value: v })
			}
		}
		const app = new Elysia().get('/', ({ query }) => query, {
			query: fakeStd as any
		})

		expect(isAsync(app)).toBe(true)
	})

	// F46 — POST+body sync handler emits the conditional-await, not `await h(c)`
	it('POST+body sync handler emits conditional await (no `await h(c)`)', () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({ n: t.Number() })
		})

		const { source } = compileRoute(app)
		expect(source).toContain('if(_r instanceof Promise)_r=await _r')
		expect(source).not.toMatch(/_r=await h\(c\)/)
	})
})

// F46/F23 — a SYNC handler returning a rejecting Promise must still reject
// inside the route try/catch so route-level (guard-scoped) error hooks fire,
// NOT just the fetch-level global handler.
describe('async-cliff: rejecting promise from sync handler hits route error hook', () => {
	it('route-level error hook sees a rejection from a sync handler', async () => {
		let seen: unknown
		const app = new Elysia()
			.error((c: any) => {
				seen = c.error
				return new Response('handled', { status: 418 })
			})
			.get('/', () =>
				// sync handler returns a rejecting promise (not awaited by user)
				Promise.reject(new Error('boom'))
			)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(418)
		expect(await res.text()).toBe('handled')
		expect((seen as Error)?.message).toBe('boom')
	})

	it('sync handler returning a resolving promise still maps normally', async () => {
		const app = new Elysia()
			.error(() => {})
			.get('/', () => Promise.resolve('ok') as any)

		const res = await app.handle(req('/'))
		expect(await res.text()).toBe('ok')
	})

	// F23 — a SYNC throw on a sync error-hook route is caught by the sync
	// try/catch and the route stays a plain Function
	it('sync throw on sync error-hook route is handled (plain Function)', async () => {
		const app = new Elysia()
			.error(({ error, set }: any) => {
				set.status = 400
				return (error as Error).message
			})
			.get('/', () => {
				throw new Error('nope')
			})

		expect(isAsync(app)).toBe(false)
		const res = await app.handle(req('/'))
		expect(res.status).toBe(400)
		expect(await res.text()).toBe('nope')
	})

	// F23 — error hook + response validator must STAY async (the thrown-then-
	// handled value runs through response validation; a naive sync drop flips it)
	it('error hook + response schema stays AsyncFunction', () => {
		const app = new Elysia()
			.error(() => {})
			.get('/', () => 'hi', {
				response: t.String()
			})

		expect(isAsync(app)).toBe(true)
	})
})

// F24 — sync afterResponse on a sync route stays a plain Function while the
// hook still fires, and a generator response is still tee'd + drained + hooks
// fire exactly once.
describe('async-cliff: sync afterResponse behaviour', () => {
	it('sync afterResponse fires for a plain value response', async () => {
		let calls = 0
		const app = new Elysia()
			.afterResponse(() => {
				calls++
			})
			.get('/', () => 'hi')

		expect(isAsync(app)).toBe(false)
		const res = await app.handle(req('/'))
		expect(await res.text()).toBe('hi')
		// afterResponse is scheduled on a microtask/setImmediate
		await new Promise((r) => setTimeout(r, 10))
		expect(calls).toBe(1)
	})

	it('generator response: tee drains and sync afterResponse fires exactly once', async () => {
		let calls = 0
		const app = new Elysia()
			.afterResponse(() => {
				calls++
			})
			.get('/', function* () {
				yield 'a'
				yield 'b'
			})

		// route is still a plain Function (the tee lives in a `.then`)
		expect(isAsync(app)).toBe(false)

		const res = await app.handle(req('/'))
		expect(await res.text()).toBe('ab')
		await new Promise((r) => setTimeout(r, 20))
		expect(calls).toBe(1)
	})

	it('sync beforeHandle short-circuit + afterResponse stays sync and fires the hook', async () => {
		let calls = 0
		const app = new Elysia()
			.afterResponse(() => {
				calls++
			})
			.get('/', () => 'handler', {
				beforeHandle: () => 'short'
			})

		expect(isAsync(app)).toBe(false)
		const res = await app.handle(req('/'))
		expect(await res.text()).toBe('short')
		await new Promise((r) => setTimeout(r, 10))
		expect(calls).toBe(1)
	})

	it('sync handler returning a generator-Promise still tees + fires afterResponse', async () => {
		let calls = 0
		const app = new Elysia()
			.afterResponse(() => {
				calls++
			})
			.get(
				'/',
				() =>
					// sync handler returns a Promise resolving to a generator
					Promise.resolve(
						(function* () {
							yield 'x'
							yield 'y'
						})()
					) as any
			)

		expect(isAsync(app)).toBe(false)
		const res = await app.handle(req('/'))
		expect(await res.text()).toBe('xy')
		await new Promise((r) => setTimeout(r, 20))
		expect(calls).toBe(1)
	})
})

// The new sync emissions (F1 `pcrs`, F23 `_ce` IIFE, F24 `_fin`/`_fin2` IIFE)
// must reconstruct through the frozen-handler path (Compiled.handlers) — the
// build captures `{alias, code}` and binds the factory instead of eval'ing it
// at request time. This proves the IIFE-wrapped helpers + the `pcrs` alias
// round-trip with identical behaviour.
describe('async-cliff: frozen-handler reconstruction', () => {
	// `build` is invoked twice (capture pass + frozen pass) and must produce the
	// SAME route shape both times; `counter` lets afterResponse share a hook
	// closure across both instances.
	const freeze = async (
		build: () => Elysia<any, any>,
		assert: (frozen: Elysia<any, any>) => Promise<void>
	) => {
		process.env.ELYSIA_AOT_BUILD = '1'
		endHandlerCapture()
		endValidatorCapture()

		;(build() as any).compile()
		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()
		expect(handlers.length).toBeGreaterThan(0)

		delete process.env.ELYSIA_AOT_BUILD
		Validator.clear()
		Compiled.validators = materialise(validators)
		Compiled.handlers = materialiseHandlers(handlers)

		const frozen = build()
		;(frozen as any).compile()
		await assert(frozen)

		Compiled.clear()
		Validator.clear()
	}

	it('reconstructs error-hook (`_ce` IIFE) via frozen factory', async () => {
		const build = () =>
			new Elysia()
				.error(({ error, set }: any) => {
					set.status = 400
					return (error as Error).message
				})
				.get('/', ({ query }: any) => {
					if (query.boom) throw new Error('boom')
					return 'ok'
				}) as any

		await freeze(build, async (frozen) => {
			expect(await (await frozen.handle(req('/'))).text()).toBe('ok')
			const err = await frozen.handle(req('/?boom=1'))
			expect(err.status).toBe(400)
			expect(await err.text()).toBe('boom')
		})
	})

	it('reconstructs afterResponse (`_fin`/`_fin2` IIFE) via frozen factory', async () => {
		const counter = { n: 0 }
		const build = () =>
			new Elysia()
				.afterResponse(() => {
					counter.n++
				})
				.get('/', ({ query }: any) => query.q ?? 'ok') as any

		await freeze(build, async (frozen) => {
			counter.n = 0
			expect(await (await frozen.handle(req('/?q=hi'))).text()).toBe('hi')
			await new Promise((r) => setTimeout(r, 10))
			expect(counter.n).toBe(1)
		})
	})

	it('reconstructs unsigned-cookie (`pcrs` alias) via frozen factory', async () => {
		const build = () =>
			new Elysia().get(
				'/',
				({ cookie }: any) => cookie.id.value ?? 'none'
			) as any

		await freeze(build, async (frozen) => {
			const res = await frozen.handle(
				req('/', { headers: { cookie: 'id=abc' } })
			)
			expect(await res.text()).toBe('abc')
		})
	})
})
