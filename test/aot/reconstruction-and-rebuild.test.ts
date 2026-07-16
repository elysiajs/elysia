import '../../src/compile/aot-capture' // installs build-only capture impl (mirrors the AOT plugin)
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import {
	Compiled,
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot'
import { compileHandler } from '../../src/compile/handler'
import { materialise, materialiseHandlers } from './_manifest'
import { post, req } from '../utils'

/**
 * Regression net for the  `src/compile/handler/index.ts` fixes.
 *
 * These cover correctness holes the type gate cannot see (codegen + the AOT
 * capture/reconstruct replay path). Each test fails on the pre-fix code and
 * encodes WHY the behaviour matters, not just the surface shape.
 */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

/**
 * route-inline named-parser strings (`parse: ['name']`) must resolve to
 * functions BEFORE the reconstruct early-return. On the AOT-frozen path the
 * captured source is `c.body=await ho.parse[0](c,ct)`; if `hook.parse[0]` is
 * still the literal `'double'`, replay calls `'double'(c,ct)` → ParseError → 400.
 * This is the eval-banned deploy path (Cloudflare), so a 400 here is a hard
 * functional break on a documented usage pattern.
 */
describe('named-parser strings resolve on the reconstruct path', () => {
	beforeEach(() => {
		process.env.ELYSIA_AOT_BUILD = '1'
		endValidatorCapture()
		endHandlerCapture()
	})
	afterEach(() => {
		delete process.env.ELYSIA_AOT_BUILD
	})

	const build = () =>
		new Elysia()
			.parser('double', async ({ request }) => {
				const text = await request.text()
				return { doubled: text + text }
			})
			.post('/x', { parse: ['double'] }, ({ body }: any) => body)

	it('frozen/reconstruct replay invokes the named parser, not the string', async () => {
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()

		expect(handlers.length).toBe(1)

		Validator.clear()
		Compiled.validators = materialise(validators)
		Compiled.handlers = materialiseHandlers(handlers)

		delete process.env.ELYSIA_AOT_BUILD
		const frozenApp = build()
		;(frozenApp as any).compile()

		const res = await frozenApp.handle(post('/x', 'ab'))
		// Pre-fix: hook.parse[0] is still 'double' on replay → 'double'(c,ct)
		// throws → ParseError → 400. Post-fix: resolved to the parser → 200.
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ doubled: 'abab' })
	})
})

/**
 * merging an instance-local `.error` into a route whose own error hook
 * is a SINGLE (non-array) function must not throw. The pre-fix code ran
 * `existing.includes(fn)` on a bare function (`.includes` undefined) →
 * `TypeError` at compile → the route returns 500 with the TypeError body
 * instead of invoking the user's error handler.
 */
describe('single-function error hook merges without throwing', () => {
	it('invokes the route error handler (599) instead of crashing (500)', async () => {
		const plugin = new Elysia()
			.get(
				'/y',
				{
					error() {
						return new Response('Y', { status: 599 })
					}
				},
				() => {
					throw new Error('boom')
				}
			)
			.error(() => {})

		const app = new Elysia().use(plugin)

		const res = await app.handle(req('/y'))
		// Pre-fix: 500 'existing.includes is not a function'. Post-fix: the
		// route's single-fn error hook runs and returns 599.
		expect(res.status).toBe(599)
		await expect(res.text()).resolves.toBe('Y')
	})
})

/**
 * a sync handler returning a STORED Promise (bare identifier, no call /
 * async / await token) defeated `mayReturnPromise`, so the route compiled sync
 * and the response validator ran `EncodeFrom` on the unawaited Promise (shape
 * `{}`) → 422 instead of resolving the Promise and validating its value.
 */
describe('sync handler returning a stored Promise is awaited', () => {
	it('resolves the Promise before response validation (200, not 422)', async () => {
		const cached = Promise.resolve({ ok: true })
		const app = new Elysia().get(
			'/x',
			{ response: { 200: t.Object({ ok: t.Boolean() }) } },
			() => cached
		)

		const res = await app.handle(req('/x'))
		// Pre-fix: validates the Promise's empty shape → 422
		// 'must have required properties ok'. Post-fix: awaited → 200.
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ ok: true })
	})

	it('a provable-literal return stays on the fast sync path', () => {
		// The fix must NOT force async for returns that cannot be a Promise — an
		// object literal is provably not a Promise, so the route stays sync.
		const app = new Elysia().get(
			'/x',
			{ response: { 200: t.Object({ ok: t.Boolean() }) } },
			() => ({ ok: true })
		)
		const route = (app as any)['~routes']![0]
		const fn = compileHandler(route, app)
		expect(fn.constructor.name).toBe('Function')
	})
})

/**
 * header extraction baked into a CAPTURED handler must be runtime
 * portable. Capturing on Bun (where `Headers.toJSON` exists) previously baked
 * the literal `c.request.headers.toJSON`, which throws on Node/Workers (no
 * `Headers.prototype.toJSON`) on every request. With no declared target the
 * capture must emit a guarded, cross-runtime form.
 */
describe('captured header extraction is runtime portable', () => {
	beforeEach(() => {
		process.env.ELYSIA_AOT_BUILD = '1'
		endValidatorCapture()
		endHandlerCapture()
	})
	afterEach(() => {
		delete process.env.ELYSIA_AOT_BUILD
	})

	const build = () =>
		new Elysia().get(
			'/h',
			{ headers: t.Object({ 'x-test': t.String() }) },
			({ headers }: any) => headers['x-test']
		)

	it('does not bake an unguarded toJSON into the captured source', () => {
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		endValidatorCapture()

		expect(handlers.length).toBe(1)
		const code = handlers[0]!.code

		// The captured code reads headers...
		expect(code).toContain('c.headers=')
		//...but never with a bare, unguarded `.toJSON` that crashes on
		// runtimes lacking it. If toJSON is referenced it must be optional.
		expect(code).not.toContain('headers.toJSON()')
		if (code.includes('toJSON')) {
			expect(code).toContain('toJSON?.()')
			expect(code).toContain('Object.fromEntries(c.request.headers)')
		}
	})

	it('the portable emission works against a Headers without toJSON', async () => {
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()

		Validator.clear()
		Compiled.validators = materialise(validators)
		Compiled.handlers = materialiseHandlers(handlers)

		delete process.env.ELYSIA_AOT_BUILD
		const frozenApp = build()
		;(frozenApp as any).compile()

		// Simulate a Node/Workers Request whose Headers has no `toJSON`: build a
		// real Request then strip the method off the headers instance.
		const request = req('/h', { headers: { 'x-test': 'ok' } })
		;(request.headers as any).toJSON = undefined

		const res = await frozenApp.handle(request)
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('ok')
	})
})

/**
 * Once the fetch handler exists (first request or
 * `.fetch` access) it is memoised in `#fetchFn`, so on the non-capture path
 * `compile` used to clear `#fetchFn` ONLY under `Capture.isCapturing` — a
 * pre-called `compile` left a stale fetch and a route was never served.
 *
 * The first request seals the app, so later authoring mutations throw. `compile`
 * must still serve every route registered before sealing, including routes added
 * after async plugins drain, and `~newGeneration` must rebuild and republish
 * during an internal hot-reload swap.
 *
 * The Bun.serve safety property still holds: the rebuild repopulates the SAME
 * `~map` / `~router` objects in place, so a fetch closure captured before the
 * swap keeps serving and sees the new routes too.
 */
describe('compile rebuild and sealed-app immutability', () => {
	it('post-seal .get throws instead of silently invalidating', async () => {
		const app = new Elysia().get('/a', () => 'a')

		// First request builds + memoises the fetch handler AND seals the app.
		expect((await app.handle(req('/a'))).status).toBe(200)

		// The retired behavior silently invalidated the router and 404'd until a
		// rebuild; the sealed instance is immutable, so the mutation throws.
		expect(() => app.get('/b', () => 'b')).toThrow(
			'after the app was sealed'
		)

		// A subsequent.compile on the sealed app still yields a working fetch for
		// the routes that WERE registered before sealing (no stale-#fetchFn 404 — the
		// original protection). If compile regressed to a no-op leaving a stale
		// handler, this could observe a torn/empty router.
		app.compile()
		expect((await app.handle(req('/a'))).status).toBe(200)
	})

	it('compile serves a route registered in the warm (post-drain, pre-seal) window', async () => {
		// An async plugin: `await app.modules` drains it and does a WARM rebuild that
		// leaves the app authorable (no seal yet). A route registered in that window
		// must be served once `.compile` seals — proving compile rebuilds the
		// fetch handler over the full pre-seal route set, not a stale snapshot.
		const app = new Elysia().use(
			Promise.resolve(new Elysia().get('/late', () => 'late'))
		)
		await app.modules
		expect(app['~generation']).toBeUndefined() // warm build, still authorable

		app.get('/warm', () => 'warm') // legal: pre-seal authoring
		app.compile() // seals + builds the fetch handler

		expect((await app.handle(req('/warm'))).status).toBe(200)
		await expect((await app.handle(req('/warm'))).text()).resolves.toBe(
			'warm'
		)
		// The async-plugin route registered before compile is served too.
		expect((await app.handle(req('/late'))).status).toBe(200)
	})

	it('~newGeneration rebuilds and republishes; a fetch captured before the swap serves the new route (Bun.serve safety)', async () => {
		const app = new Elysia().get('/a', () => 'a')

		// Simulate the reference Bun.serve holds after listen: the fetch closure
		// captured at listen time. The first call seals the app.
		const capturedFetch = app.fetch
		expect((await capturedFetch(req('/a'))).status).toBe(200)
		const previous = app['~generation']
		expect(previous).toBeDefined()

		// Dev hot-reload swap: unseal, add a route through the authoring window, then
		// atomically republish via the internal ~newGeneration (mirrors
		// generation.test.ts). This exercises the same rebuild machinery.
		;(app as any)['~generation'] = undefined
		app.get('/b', () => 'b')
		app['~newGeneration']()
		expect(app['~generation']).not.toBe(previous)

		// The rebuild repopulated the same ~map/~router objects in place, so the
		// pre-swap fetch closure now serves the new route AND the original one.
		expect((await capturedFetch(req('/b'))).status).toBe(200)
		await expect((await capturedFetch(req('/b'))).text()).resolves.toBe('b')
		expect((await capturedFetch(req('/a'))).status).toBe(200)
	})

	it('~newGeneration rebuilds for dynamic routes added through the unseal window', async () => {
		const app = new Elysia().get('/u/:id', ({ params }: any) => params.id)
		const capturedFetch = app.fetch
		expect((await capturedFetch(req('/u/1'))).status).toBe(200)
		;(app as any)['~generation'] = undefined
		app.get('/v/:id', ({ params }: any) => 'v' + params.id)
		app['~newGeneration']()

		const res = await capturedFetch(req('/v/9'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('v9')
		// The original dynamic route still resolves through the same router object.
		expect((await capturedFetch(req('/u/1'))).status).toBe(200)
	})
})

/**
 * applyHook returned the caller's `localHook` by reference on the
 * rootHook-less path, then compileHandler mutated it in place (promoteDerive
 * moves `derive`→`beforeHandle`, `parse` is arrayified). A hook-options object
 * shared across routes would be silently rewritten under the caller's feet.
 */
describe('compileHandler does not mutate a caller-owned hook', () => {
	it('leaves a shared hook-options object untouched after compile', () => {
		const parseFn = () => undefined
		const deriveFn = () => ({})
		const sharedHook: any = { parse: parseFn, derive: deriveFn }

		const app = new Elysia().get('/a', sharedHook, () => 'ok')
		const route = (app as any)['~routes']![0]
		compileHandler(route, app)

		// Pre-fix: promoteDerive set derive→undefined + prepended into
		// beforeHandle, toArray arrayified parse — all on the user's object.
		expect(sharedHook.derive).toBe(deriveFn)
		expect(sharedHook.parse).toBe(parseFn)
		expect(sharedHook.beforeHandle).toBeUndefined()
	})
})
