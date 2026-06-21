import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req, post } from '../utils'

// Regression tests for the kiana base fixes (src/base.ts).
// Each test fails on the pre-fix code and passes after the fix.

describe('base fixes (kiana)', () => {
	// idx0 — a guard/group hook that carries `derive` must keep its schema keys.
	// #pushHook previously rebuilt the promoted hook by copying ONLY
	// eventProperties keys, which excludes body/query/params/headers/cookie/
	// response/schema/schemas, so the presence of `derive` silently wiped all
	// validation. WHY it matters: validation is a security/correctness boundary;
	// dropping it on a derive-bearing guard turns a 422 into a 200 that runs the
	// handler with unvalidated input.
	it('keeps query validation on a guard that also declares derive', async () => {
		const app = new Elysia()
			.guard({
				query: t.Object({ x: t.String() }),
				derive: () => ({ k: 42 })
			})
			.get('/', ({ query, k }: any) => ({ query, k }))

		// missing ?x must 422 (the inherited query schema must still run)
		expect((await app.handle(req('/'))).status).toBe(422)

		// with ?x the derive must still merge into context
		const ok = await app.handle(req('/?x=hello'))
		expect(ok.status).toBe(200)
		expect(await ok.json()).toEqual({ query: { x: 'hello' }, k: 42 })
	})

	it('keeps body validation on a guard that also declares derive', async () => {
		const app = new Elysia()
			.guard({
				body: t.Object({ name: t.String() }),
				derive: () => ({ k: 1 })
			})
			.post('/', ({ body }: any) => body)

		// empty body must 422, not 200
		expect((await app.handle(post('/', {}))).status).toBe(422)
		expect((await app.handle(post('/', { name: 'a' }))).status).toBe(200)
	})

	it('keeps query validation on group(prefix, { query, derive }, run)', async () => {
		const app = new Elysia().group(
			'/api',
			{ query: t.Object({ x: t.String() }), derive: () => ({ k: 1 }) },
			(g) => g.get('/x', ({ query }: any) => query)
		)

		expect((await app.handle(req('/api/x'))).status).toBe(422)
		expect((await app.handle(req('/api/x?x=ok'))).status).toBe(200)
	})

	// idx6 — an array-valued guard `derive` must register its ELEMENT functions
	// in the ~derive WeakSet (so each is compiled as a derive, merging into
	// context) instead of registering the array object as a single key (which
	// makes each element compile as a normal beforeHandle guard whose object
	// return short-circuits the route). WHY: a derive returning an object must
	// enrich context, never become the HTTP response body.
	it('treats an array-valued guard derive as derives, not short-circuit guards', async () => {
		const app = new Elysia()
			.guard({
				derive: [() => ({ user: 'bob' }), () => ({ role: 'admin' })]
			})
			.get('/', ({ user, role }: any) => ({
				user,
				role,
				handlerRan: true
			}))

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		// pre-fix: body would be { user: 'bob' } (first derive short-circuited)
		expect(await res.json()).toEqual({
			user: 'bob',
			role: 'admin',
			handlerRan: true
		})
	})

	// idx7 — an explicitly-registered route must not be clobbered by the
	// trailing-slash loose twin of another route. With strictPath off, /foo and
	// /foo/ are distinct registrations; building one must not overwrite the
	// other's real map entry. WHY: silent wrong-handler dispatch on a declared
	// route is a correctness violation that no error surfaces.
	it('does not let a /foo/ loose twin clobber an explicit /foo route', async () => {
		const app = new Elysia()
			.get('/foo', () => 'real-foo')
			.get('/foo/', () => 'foo-slash')

		expect(await (await app.handle(req('/foo'))).text()).toBe('real-foo')
		expect(await (await app.handle(req('/foo/'))).text()).toBe('foo-slash')
	})

	it('clobber-guard holds regardless of registration order', async () => {
		const app = new Elysia()
			.get('/foo/', () => 'foo-slash')
			.get('/foo', () => 'real-foo')

		expect(await (await app.handle(req('/foo'))).text()).toBe('real-foo')
		expect(await (await app.handle(req('/foo/'))).text()).toBe('foo-slash')
	})

	it('still serves the loose twin when only one variant is declared', async () => {
		const app = new Elysia().get('/bar', () => 'bar')

		// strictPath off (default): /bar/ resolves to the /bar handler
		expect(await (await app.handle(req('/bar/'))).text()).toBe('bar')
	})

	// idx8 — schemas inherited via `.use()` under a parent guard/group must
	// appear in `.routes` introspection (consumed by OpenAPI/Swagger). The
	// getter previously ignored the inheritedChain tuple slot, so docs disagreed
	// with the runtime (which DOES enforce the inherited guard).
	// idx8 — `.routes` introspection must surface schemas inherited via
	// `.use()` under a parent guard/group (OpenAPI/Swagger), matching what the
	// runtime enforces. `composeRouteHook` is shared by the runtime and the
	// getter so the two cannot diverge (a prior approximate fold double-counted
	// hooks and was reverted; the origin-dedup in the shared path prevents it).
	it('surfaces inherited guard schemas at runtime and on .routes', async () => {
		const inner = new Elysia().get('/x', () => 'ok')
		const app = new Elysia()
			.guard({ query: t.Object({ q: t.String() }) })
			.use(inner)

		// runtime enforces the inherited guard
		expect((await app.handle(req('/x'))).status).toBe(422)
		expect((await app.handle(req('/x?q=hi'))).status).toBe(200)

		// introspection reflects it too (was dropped before idx8)
		const route = app.routes.find((r) => r.path === '/x')
		expect(route).toBeDefined()
		expect((route!.hooks as any)?.query).toBeDefined()
	})

	// idx9 — headers() must not alias the caller's object. A subsequent
	// .headers() call does Object.assign into the stored object; if it is the
	// caller's variable, the user's object (and any other instance sharing it)
	// is mutated. WHY: a public builder method must not mutate its argument.
	it('does not mutate the caller object passed to headers()', () => {
		const shared = { 'x-a': '1' }
		const app = new Elysia().headers(shared)

		app.headers({ 'x-b': '2' })

		// the caller's object must be untouched
		expect(shared).toEqual({ 'x-a': '1' })
		// while the instance accumulated both
		expect((app['~ext'] as any)?.headers).toEqual({
			'x-a': '1',
			'x-b': '2'
		})
	})

	// idx10 — ws() must not mutate the caller's options object by writing
	// opts.message. Reusing one options object across .ws() calls would
	// otherwise leave a stale message and throw a spurious conflict error.
	it('does not mutate the caller options across multiple ws() calls', () => {
		const opts = { idleTimeout: 5 } as any
		const hA = () => {}
		const hB = () => {}

		expect(() => {
			new Elysia().ws('/a', opts, hA)
			new Elysia().ws('/b', opts, hB)
		}).not.toThrow()

		// the caller's options object must be untouched (no leaked message)
		expect(opts.message).toBeUndefined()
		expect(opts).toEqual({ idleTimeout: 5 })
	})

	// idx44 — a plugin's nested plain-object decorator must not be aliased into
	// the parent by reference; otherwise the two instances share the object and
	// a mutation through one leaks into the other. Class instances / functions
	// (intended singletons) are still shared by reference.
	it('does not alias a plugin nested plain-object decorator into the parent', () => {
		const plugin = new Elysia({ name: 'p' }).decorate('ctx', {
			db: 'plugin-db'
		})
		const parent = new Elysia().use(plugin)

		const parentCtx = (parent['~ext'] as any)?.decorator?.ctx
		const pluginCtx = (plugin['~ext'] as any)?.decorator?.ctx

		expect(parentCtx).toBeDefined()
		expect(parentCtx).toEqual({ db: 'plugin-db' })
		// the nested object must be a distinct copy, not a shared reference
		expect(parentCtx).not.toBe(pluginCtx)

		// mutating the parent's copy must not leak into the plugin's
		parentCtx.db = 'mutated'
		expect(pluginCtx.db).toBe('plugin-db')
	})

	it('still shares class-instance decorators by reference (singleton)', () => {
		class Db {
			value = 'shared'
		}
		const instance = new Db()
		const plugin = new Elysia({ name: 'p2' }).decorate('db', instance)
		const parent = new Elysia().use(plugin)

		expect((parent['~ext'] as any)?.decorator?.db).toBe(instance)
	})
})
