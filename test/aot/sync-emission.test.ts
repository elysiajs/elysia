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
import { hasSyncHmac } from '../../src/cookie/utils'

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
		await expect((await app.handle(req('/'))).text()).resolves.toBe('hi')
	})

	it('async handler stays AsyncFunction', async () => {
		// A query schema (sync TypeBox validator) links a 2nd param, forcing the
		// `new Function('route')` tail instead of the single-param inline
		// fast-path (`createInlineHandler`, always a plain arrow) — so the route
		// function's own async-ness is observable.
		const app = new Elysia().get(
			'/',
			{
				query: t.Object({ q: t.Optional(t.String()) })
			},
			async () => 'hi'
		)

		expect(isAsync(app)).toBe(true)
		await expect((await app.handle(req('/?q=1'))).text()).resolves.toBe(
			'hi'
		)
	})

	// F23 — error hook
	it('sync GET + sync error hook is a plain Function', async () => {
		const app = new Elysia().error(() => {}).get('/', () => 'hi')

		expect(isAsync(app)).toBe(false)
		await expect((await app.handle(req('/'))).text()).resolves.toBe('hi')
	})

	it('sync GET + async error hook stays AsyncFunction', () => {
		const app = new Elysia().error(async () => {}).get('/', () => 'hi')

		expect(isAsync(app)).toBe(true)
	})

	// F24 — afterResponse
	it('sync GET + sync afterResponse is a plain Function', async () => {
		const app = new Elysia().afterResponse(() => {}).get('/', () => 'hi')

		expect(isAsync(app)).toBe(false)
		await expect((await app.handle(req('/'))).text()).resolves.toBe('hi')
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
		await expect(ok.text()).resolves.toBe('hi')

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
		await expect(r.text()).resolves.toBe('mapped-err')
	})

	// F1 — unsigned cookie
	it('GET reading an unsigned cookie is a plain Function', async () => {
		const app = new Elysia().get('/', ({ cookie }) => {
			cookie.id.value
			return 'hi'
		})

		expect(isAsync(app)).toBe(false)
		await expect(
			(
				await app.handle(req('/', { headers: { cookie: 'id=abc' } }))
			).text()
		).resolves.toBe('hi')
	})

	// signed cookie — H3: signing uses a sync `node:crypto` HMAC when available
	// (Bun/Node), so a signed-cookie route no longer forces the handler async.
	// Only the async WebCrypto fallback (edge runtimes without `node:crypto`,
	// or AOT capture where the deploy target is unknown) keeps it async. See
	// test/cookie/hmac-parity.test.ts for the AOT-capture-stays-async guard.
	it('GET reading a signed cookie is sync when a sync HMAC is available', () => {
		const app = new Elysia({
			cookie: { sign: ['id'], secrets: 'secret' }
		}).get('/', ({ cookie }) => {
			cookie.id.value
			return 'hi'
		})

		expect(isAsync(app)).toBe(!hasSyncHmac)
	})

	// F26 — sync parse hook on a bodyless GET
	it('app-level sync .parse + bodyless GET is a plain Function', async () => {
		const app = new Elysia().parse(() => {}).get('/', () => 'hi')

		expect(isAsync(app)).toBe(false)
		await expect((await app.handle(req('/'))).text()).resolves.toBe('hi')
	})

	// F26 — bodyless GET/HEAD skips the parse block entirely (method-gated), so
	// even an async parse hook does not drag a bodyless GET onto the async path
	// (the hook simply doesn't fire on a body-less method, matching v1).
	it('app-level async .parse + bodyless GET is a plain Function (parse skipped)', async () => {
		const app = new Elysia().parse(async () => {}).get('/', () => 'hi')

		expect(isAsync(app)).toBe(false)
		await expect((await app.handle(req('/'))).text()).resolves.toBe('hi')
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
		await expect(res.json()).resolves.toEqual({ ok: 1 })
	})

	// F26 — explicit body schema on a GET still forces parsing (validation runs)
	it('GET with explicit body schema stays AsyncFunction (parse forced)', () => {
		const app = new Elysia().get(
			'/',
			{
				body: t.Object({ n: t.Number() })
			},
			({ body }) => body
		)

		expect(isAsync(app)).toBe(true)
	})

	// POST body — async (real body read)
	it('POST with t.Object body stays AsyncFunction (body read is async)', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({ n: t.Number() })
			},
			({ body }) => body
		)

		expect(isAsync(app)).toBe(true)
		await expect(
			(await app.handle(post('/', { n: 5 }))).json()
		).resolves.toEqual({
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
		const app = new Elysia().get(
			'/',
			{
				query: t.Object({ q: t.Optional(t.String()) }),
				schemas: [fakeStd as any]
			},
			({ query }) => query
		)

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
		const app = new Elysia().get(
			'/',
			{
				query: fakeStd as any
			},
			({ query }) => query
		)

		expect(isAsync(app)).toBe(true)
	})

	// F46 — POST+body sync handler emits the conditional-await, not `await h(c)`
	it('POST+body sync handler emits conditional await (no `await h(c)`)', () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({ n: t.Number() })
			},
			({ body }) => body
		)

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
		await expect(res.text()).resolves.toBe('handled')
		expect((seen as Error)?.message).toBe('boom')
	})

	it('sync handler returning a resolving promise still maps normally', async () => {
		const app = new Elysia()
			.error(() => {})
			.get('/', () => Promise.resolve('ok') as any)

		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('ok')
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
		await expect(res.text()).resolves.toBe('nope')
	})

	// F23 — error hook + response validator must STAY async (the thrown-then-
	// handled value runs through response validation; a naive sync drop flips it)
	it('error hook + response schema stays AsyncFunction', () => {
		const app = new Elysia()
			.error(() => {})
			.get(
				'/',
				{
					response: t.String()
				},
				() => 'hi'
			)

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
		await expect(res.text()).resolves.toBe('hi')
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
		await expect(res.text()).resolves.toBe('ab')
		await new Promise((r) => setTimeout(r, 20))
		expect(calls).toBe(1)
	})

	it('sync beforeHandle short-circuit + afterResponse stays sync and fires the hook', async () => {
		let calls = 0
		const app = new Elysia()
			.afterResponse(() => {
				calls++
			})
			.get(
				'/',
				{
					beforeHandle: () => 'short'
				},
				() => 'handler'
			)

		expect(isAsync(app)).toBe(false)
		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('short')
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
		await expect(res.text()).resolves.toBe('xy')
		await new Promise((r) => setTimeout(r, 20))
		expect(calls).toBe(1)
	})
})

// C7/H21/M2 — the async-inference contract (design/codegen-async-contract.md).
//
// Elysia never forces a lifecycle hook async, so a SYNC hook/handler may still
// *return* a Promise. Codegen must (1) drive the route async when the source
// heuristic flags such a fn, (2) emit a runtime `instanceof Promise` await
// guard after each sync hook in an async route (safety-net for heuristic
// false-negatives), and (3) await `_r` before afterHandle/mapResponse/response
// -validator observe it. A silently-returned `[object Promise]` is the bug.
describe('async-cliff: sync fn returning a Promise (C7/H21/M2)', () => {
	// (a) C7 — a SYNC beforeHandle that returns a Promise must early-return its
	// RESOLVED value and skip the handler, matching an async beforeHandle. Before
	// the fix the un-awaited Promise became `_r` and short-circuited the handler,
	// serialising `[object Promise]` as the response.
	it('sync beforeHandle returning a Promise resolves + skips the handler', async () => {
		let handlerRan = false
		const app = new Elysia().get(
			'/',
			{
				// sync arrow, returns a Promise resolving to a response value
				beforeHandle: () => Promise.resolve('short') as any
			},
			() => {
				handlerRan = true
				return 'handler'
			}
		)

		// C7 forcing: the heuristic flags the sync beforeHandle → route is async
		expect(isAsync(app)).toBe(true)

		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('short')
		// handler-skip semantics match standard async-beforeHandle short-circuit
		expect(handlerRan).toBe(false)
	})

	// (b) H21 — a SYNC handler returning a Promise + a SYNC afterHandle: the
	// afterHandle must observe the RESOLVED value, not the Promise. Before the
	// fix `_r` stayed a Promise (route was sync, only the error path was chained)
	// so afterHandle saw `[object Promise]`.
	it('sync handler returning a Promise: sync afterHandle sees the resolved value', async () => {
		let seen: unknown
		const app = new Elysia().get(
			'/',
			{
				afterHandle: ({ responseValue }: any) => {
					seen = responseValue
					return `wrapped:${responseValue}`
				}
			},
			// sync handler, returns a Promise resolving to a plain value
			() => Promise.resolve('value') as any
		)

		// H21 forcing: handler may return a Promise + afterHandle observes it
		expect(isAsync(app)).toBe(true)

		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('wrapped:value')
		expect(seen).toBe('value')
	})

	// (b') same for a SYNC mapResponse observing the resolved handler value
	it('sync handler returning a Promise: sync mapResponse sees the resolved value', async () => {
		const app = new Elysia().get(
			'/',
			{
				mapResponse: ({ responseValue }: any) =>
					new Response(`mapped:${responseValue}`)
			},
			() => Promise.resolve('value') as any
		)

		expect(isAsync(app)).toBe(true)
		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('mapped:value')
	})

	// (c) M2 — a genuinely minified `=>x` handler (no space after `=>`, as a
	// bundler emits) with a response validator must validate correctly. Test
	// source in bun is re-tokenised (a space is re-inserted), so the minified
	// arrow is built via `eval` to preserve the verbatim `=>c` in `.toString()`.
	it('minified `=>x` handler with a response validator validates', async () => {
		// eslint-disable-next-line no-eval
		const minified = (0, eval)('(c)=>c.query.n') as (c: any) => unknown
		expect(minified.toString()).toContain('=>c') // truly no space

		const app = new Elysia().get(
			'/',
			{
				query: t.Object({ n: t.String() }),
				response: t.String()
			},
			minified
		)

		const ok = await app.handle(req('/?n=hi'))
		expect(ok.status).toBe(200)
		await expect(ok.text()).resolves.toBe('hi')
	})

	// (c') M2 — a minified `=>x` handler that returns a Promise-producing
	// identifier must be awaited before response validation (heuristic must fire
	// on the no-space arrow). `p` is a Promise; without the `\s*` fix the route
	// stays sync and the validator sees a Promise.
	it('minified `=>x` handler returning a Promise-producing identifier is awaited', async () => {
		// eslint-disable-next-line no-eval
		const minified = (0, eval)('(c)=>c.store.p') as (c: any) => unknown
		expect(minified.toString()).toContain('=>c')

		const app = new Elysia()
			.state('p', Promise.resolve('deferred'))
			.get(
				'/',
				{ response: t.String() },
				minified as any
			)

		// heuristic sees the identifier-return → responseValiForcesAsync fires
		expect(isAsync(app)).toBe(true)
		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('deferred')
	})

	// (d) sync-emission pin — a PROVABLY-sync route (sync handler with a plain
	// value, sync hooks whose returns provably can't be a Promise) still emits a
	// plain Function. The forcing additions must not drag a genuinely-sync route
	// onto the async path.
	//
	// NOTE: this pin previously included `afterHandle: ({response}) => response`
	// and asserted sync. That was the C7 hole (see the identifier-observed tests
	// below): a pass-through hook returning a bare identifier CAN hold a Promise,
	// and in a sync route its raw Promise was silently assigned to `_r`. The
	// fix makes beforeHandle/afterHandle/mapResponse observe the identifier
	// heuristic, so a `=> identifier` afterHandle now forces async (a
	// false-positive costs perf only — the contract's mandated failure
	// direction). This pin now uses hook returns neither heuristic can flag
	// (empty block / object literal) so it genuinely stays sync.
	it('provably-sync handler + sync hooks stay a plain Function', () => {
		const app = new Elysia().get(
			'/',
			{
				// none of these returns can be a Promise the heuristic sees:
				// empty block + object literal → mayReturnPromise/Identifier miss
				beforeHandle: () => {},
				afterHandle: () => {},
				transform: () => {}
			},
			() => ({ ok: 1 })
		)

		expect(isAsync(app)).toBe(false)
	})

	// (d0) C7 identifier hole — a bare-identifier beforeHandle (`=> p`) holding a
	// Promise must force the route async, resolve the hook, and (since the hook
	// resolved to undefined) run the handler. Before the fix the un-awaited
	// Promise became a defined `_r`, silently skipping the handler and
	// serialising "" (the exact Codex repro). Pins both emission and wire.
	it('bare-identifier beforeHandle returning a Promise forces async and runs the handler', async () => {
		const p = Promise.resolve(undefined)
		let handlerRan = false
		const app = new Elysia().get(
			'/',
			{ beforeHandle: () => p },
			() => {
				handlerRan = true
				return 'ok'
			}
		)

		// identifier heuristic on an observed-result hook → route async
		expect(isAsync(app)).toBe(true)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		// hook resolved to undefined → handler runs, its value is the response
		await expect(res.text()).resolves.toBe('ok')
		expect(handlerRan).toBe(true)
	})

	// (d0') a bare-identifier beforeHandle resolving to a DEFINED value must
	// short-circuit the handler with the RESOLVED value (parity with an async
	// beforeHandle), not the raw Promise.
	it('bare-identifier beforeHandle Promise resolving to a value short-circuits with the resolved value', async () => {
		const p = Promise.resolve('short')
		let handlerRan = false
		const app = new Elysia().get(
			'/',
			{ beforeHandle: () => p },
			() => {
				handlerRan = true
				return 'handler'
			}
		)

		expect(isAsync(app)).toBe(true)
		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('short')
		expect(handlerRan).toBe(false)
	})

	// (d0'') afterHandle observing a bare-identifier Promise: the resolved value
	// (not `[object Promise]`) must reach the wire.
	it('bare-identifier afterHandle returning a Promise is resolved before it becomes the response', async () => {
		const p = Promise.resolve('wrapped')
		const app = new Elysia().get(
			'/',
			{ afterHandle: () => p as any },
			() => 'orig'
		)

		expect(isAsync(app)).toBe(true)
		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('wrapped')
	})

	// (d0''') mapResponse observing a bare-identifier Promise resolving to a
	// Response.
	it('bare-identifier mapResponse returning a Promise is resolved before it becomes the response', async () => {
		const p = Promise.resolve(new Response('mapped'))
		const app = new Elysia().get(
			'/',
			{ mapResponse: () => p as any },
			() => 'orig'
		)

		expect(isAsync(app)).toBe(true)
		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('mapped')
	})

	// (d0'''') pass-through `=> response` afterHandle: now forces async (the
	// identifier heuristic can't prove the identifier isn't a Promise), but its
	// WIRE behaviour must stay correct — the response passes through unchanged.
	// This is the contract's mandated failure direction: a false-positive costs
	// async-route perf, never a wrong value.
	it('pass-through `=> response` afterHandle stays wire-correct (forces async)', async () => {
		const app = new Elysia().get(
			'/',
			{ afterHandle: ({ response }: any) => response },
			() => 'passthru'
		)

		expect(isAsync(app)).toBe(true)
		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('passthru')
	})

	// (d0''''') transform's return is DISCARDED, so a bare-identifier transform
	// holding a Promise cannot corrupt the response — it stays on the narrow
	// call heuristic and does NOT force async. Pins that transform was correctly
	// excluded from the identifier heuristic (perf: no async frame for a hook
	// whose return is never read).
	it('bare-identifier transform stays sync (return is discarded)', async () => {
		const p = Promise.resolve('unused')
		let handlerRan = false
		const app = new Elysia().get(
			'/',
			{ transform: () => p as any },
			() => {
				handlerRan = true
				return 'ok'
			}
		)

		expect(isAsync(app)).toBe(false)
		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('ok')
		expect(handlerRan).toBe(true)
	})

	// (d') the async-route safety-net guard is emitted for a sync hook: source
	// must contain the `instanceof Promise` await guard on `tmp`.
	it('async route emits an instanceof-Promise await guard for a sync beforeHandle', () => {
		const app = new Elysia().get(
			'/',
			{ beforeHandle: () => Promise.resolve('x') as any },
			() => 'hi'
		)

		const { source } = compileRoute(app)
		expect(source).toContain('tmp instanceof Promise')
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
			await expect((await frozen.handle(req('/'))).text()).resolves.toBe(
				'ok'
			)
			const err = await frozen.handle(req('/?boom=1'))
			expect(err.status).toBe(400)
			await expect(err.text()).resolves.toBe('boom')
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
			await expect(
				(await frozen.handle(req('/?q=hi'))).text()
			).resolves.toBe('hi')
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
			await expect(res.text()).resolves.toBe('abc')
		})
	})
})
