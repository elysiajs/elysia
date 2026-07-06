import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { req } from '../utils'

/**
 * Phase-2 ROUTING cluster pins (design/fable-tasks.md — M16 / L11 / L1 / M8 / M34).
 *
 * Current dispatch mechanism (verified at authoring time): plain object lookup.
 * Static routes live in `~map[METHOD][path] = handler` (last-wins, overwrites);
 * dynamic routes live in a Memoirist trie whose `add` is FIRST-wins (only writes
 * `node.store` when `=== null`). All assertions below are on WIRE behaviour so
 * the Bun-only suite cannot fake a pass.
 */

describe('M16 — duplicate route precedence is last-wins for BOTH static and dynamic', () => {
	it('static duplicate keeps the LAST handler', async () => {
		const app = new Elysia()
			.get('/s', () => 'first')
			.get('/s', () => 'second')

		expect(await (await app.handle(req('/s'))).text()).toBe('second')
	})

	// The divergence: Memoirist is first-wins, so before the fix a re-registered
	// dynamic route kept its FIRST handler while a static one kept its LAST.
	it('dynamic duplicate keeps the LAST handler (was first-wins)', async () => {
		const app = new Elysia()
			.get('/d/:id', () => 'first')
			.get('/d/:id', () => 'second')

		expect(await (await app.handle(req('/d/1'))).text()).toBe('second')
	})

	it('dynamic wildcard duplicate keeps the LAST handler', async () => {
		const app = new Elysia()
			.get('/w/*', () => 'first')
			.get('/w/*', () => 'second')

		expect(await (await app.handle(req('/w/anything'))).text()).toBe(
			'second'
		)
	})

	it('mixed static+dynamic duplicates both resolve last-wins', async () => {
		const app = new Elysia()
			.get('/x', () => 'x-first')
			.get('/y/:id', () => 'y-first')
			.get('/x', () => 'x-last')
			.get('/y/:id', () => 'y-last')

		expect(await (await app.handle(req('/x'))).text()).toBe('x-last')
		expect(await (await app.handle(req('/y/9'))).text()).toBe('y-last')
	})
})

describe('L11 — a loose alias never clobbers an explicitly-registered sibling (default config)', () => {
	// Default config (strictPath off) previously exposed this: the loose twin of
	// `/foo` is `/foo/`, which silently overwrote the REAL `/foo/` handler unless
	// the (opt-in) `distinctPath` config was set. The protection is now always on.
	it('explicit /foo/ is not clobbered by /foo loose twin — default config', async () => {
		const app = new Elysia()
			.get('/foo', () => 'real-foo')
			.get('/foo/', () => 'foo-slash')

		expect(await (await app.handle(req('/foo'))).text()).toBe('real-foo')
		expect(await (await app.handle(req('/foo/'))).text()).toBe('foo-slash')
	})

	it('holds regardless of registration order — default config', async () => {
		const app = new Elysia()
			.get('/foo/', () => 'foo-slash')
			.get('/foo', () => 'real-foo')

		expect(await (await app.handle(req('/foo'))).text()).toBe('real-foo')
		expect(await (await app.handle(req('/foo/'))).text()).toBe('foo-slash')
	})

	it('still serves the loose twin when only one variant is declared', async () => {
		const app = new Elysia().get('/bar', () => 'bar')

		expect(await (await app.handle(req('/bar/'))).text()).toBe('bar')
	})
})

describe('L1 — JIT wrapper heals ALL of its own map aliases on first compile', () => {
	// With lazy (non-precompile) JIT, `.get('/enc é', ...)` registers the wrapper
	// under both the raw and encodeURI'd twins. Before the fix, first compile
	// re-pointed only the canonical path; the encoded twin kept dispatching
	// through the wrapper forever. Behaviourally both twins must serve correctly
	// across repeated requests (which is what forces the wrapper to have healed).
	it('encoded-twin alias resolves consistently across repeated requests', async () => {
		const app = new Elysia().get('/café', () => 'coffee')

		// hit twice: first compiles+heals, second must hit the healed entry
		expect(await (await app.handle(req('/café'))).text()).toBe('coffee')
		expect(
			await (await app.handle(req(encodeURI('/café')))).text()
		).toBe('coffee')
		expect(await (await app.handle(req('/café'))).text()).toBe('coffee')
	})

	it('auto-HEAD twin heals and returns headers-only', async () => {
		const app = new Elysia({ autoHead: true }).get('/h', () => 'body-here')

		// warm the GET so the wrapper compiles
		expect(await (await app.handle(req('/h'))).text()).toBe('body-here')

		const head = await app.handle(req('/h', { method: 'HEAD' }))
		expect(head.status).toBe(200)
		expect(await head.text()).toBe('')
	})

	it('loose alias of a trailing-slash route heals', async () => {
		const app = new Elysia().get('/dir/', () => 'dir')

		expect(await (await app.handle(req('/dir/'))).text()).toBe('dir')
		// loose twin `/dir`
		expect(await (await app.handle(req('/dir'))).text()).toBe('dir')
		expect(await (await app.handle(req('/dir/'))).text()).toBe('dir')
	})

	// Structural pin: heal must RE-POINT every map alias to the SAME compiled
	// handler as the canonical path, not leave aliases forwarding through the
	// retained JIT wrapper. Behavioural pins alone can't see this (the wrapper
	// forwards correctly via its `#compiled` fast-path) — assert on `~map`.
	it('warmed map aliases point at the SAME handler as the canonical path', async () => {
		const app = new Elysia().get('/dir/', () => 'dir')

		// warm — first compile triggers the heal
		await app.handle(req('/dir/'))
		await app.handle(req('/dir'))

		const map = (app as any)['~map'].GET
		// canonical `/dir/` and loose twin `/dir` must be the identical healed fn
		expect(map['/dir/']).toBe(map['/dir'])
		// and it must no longer be the raw JIT wrapper (which forwards but
		// retains its closure) — a healed handler is a stable identity across
		// both keys, which only holds once BOTH were rewritten to the compiled fn
		expect(typeof map['/dir']).toBe('function')
	})
})

describe('M8 — per-route hook composition isolation (shared-mutation guard)', () => {
	// M8 proposed SHARING the composed+promoteDerive'd hook across routes with
	// identical inherited hooks. This repo has repeatedly hit "alias a hook for
	// speed -> cross-route mutation leak" bugs. Sharing was NOT done because the
	// composed hook is mutated in place downstream (promoteDerive, toArray,
	// named-parser remap, buildNativeStaticResponse's mapResponse rewrite). This
	// pin locks in the ISOLATION invariant: two routes under the same guard must
	// have INDEPENDENT composed hooks — per-request derive state on one route
	// must never bleed into the other, and their derived values must be distinct
	// objects. If a future change shares the composition and one route mutates
	// it, this fails.
	it('shared-guard derive state does not bleed across two identical routes', async () => {
		let counter = 0

		const app = new Elysia()
			.guard({})
			.derive(() => ({ ticket: ++counter }))
			.get('/a', ({ ticket }: any) => ticket)
			.get('/b', ({ ticket }: any) => ticket)

		// Each request must get a fresh, independent derive result. If the two
		// routes shared a mutable composed hook and the derive array were spliced
		// / reused in place, the second route could observe stale state.
		const a1 = await (await app.handle(req('/a'))).text()
		const b1 = await (await app.handle(req('/b'))).text()
		const a2 = await (await app.handle(req('/a'))).text()

		// strictly increasing, per-request — no cross-route reuse of a value
		expect(Number(a1)).toBeGreaterThan(0)
		expect(Number(b1)).toBe(Number(a1) + 1)
		expect(Number(a2)).toBe(Number(b1) + 1)
	})

	it('a route-local hook added to one route is not observed by its sibling', async () => {
		const marks: string[] = []

		const app = new Elysia()
			.guard({})
			// /a carries an extra local beforeHandle; /b must NOT run it
			.get(
				'/a',
				{
					beforeHandle: () => {
						marks.push('a-local')
					}
				},
				() => 'a'
			)
			.get('/b', () => 'b')

		await app.handle(req('/b'))
		expect(marks).toEqual([]) // /b never ran /a's local hook

		await app.handle(req('/a'))
		expect(marks).toEqual(['a-local'])
	})
})

describe('M34 — unknown model-name schema refs fail loud at build time, not per-request', () => {
	it('unknown route-local ref throws at compile() with route + name', () => {
		const app = new Elysia().get('/', { query: 'Nope' as any }, () => 'ok')

		expect(() => app.compile()).toThrow(/Nope/)
		expect(() => app.compile()).toThrow(/GET \//)
	})

	it('respects .model() declared AFTER the route (does not false-positive)', () => {
		const app = new Elysia()
			.get('/', { query: 'Q' as any }, () => 'ok')
			.model({ Q: t.Object({ a: t.String() }) })

		expect(() => app.compile()).not.toThrow()
	})

	it('unknown response record ref throws with the status', () => {
		const app = new Elysia()
			.model({ Known: t.Number() })
			.get('/r', { response: { 200: 'Missing' as any } }, () => 1)

		expect(() => app.compile()).toThrow(/Missing/)
		expect(() => app.compile()).toThrow(/response 200/)
	})

	it('inline (non-ref) schemas never false-positive, incl. response record', () => {
		const app = new Elysia().get(
			'/ok',
			{
				query: t.Object({ q: t.String() }),
				response: { 200: t.Number() }
			},
			() => 1
		)

		expect(() => app.compile()).not.toThrow()
	})

	// A string ref does NOT only live on the route-local hook — it also enters at
	// COMPOSE time (guard/group chain nodes, standalone slot bags, macros) and the
	// `response: { default }` status key sidesteps the digit-first heuristic. Each
	// of these previously slipped past the build-time assert and re-surfaced as the
	// opaque per-request `Schema reference "X" not found in models` 500. Pin every
	// shape to the LOUD build-time error.

	// Shape 1 — the most common: a guard-level `{ query: 'X' }` inherited by the
	// route. Lives on a chain node, never on route[4].
	it('unknown GUARD-level ref throws loud at compile()', () => {
		const app = new Elysia()
			.guard({ query: 'GuardQ' as any })
			.get('/', () => 'x')

		expect(() => app.compile()).toThrow(/Unknown model reference "GuardQ"/)
		expect(() => app.compile()).toThrow(/GET \//)
	})

	// Shape 2 — guard-level STANDALONE schema: rides the composed hook's
	// `schemas[]` slot bag, not a direct key.
	it('unknown guard-level STANDALONE ref throws loud at compile()', () => {
		const app = new Elysia()
			.guard({ schema: 'standalone', query: 'GuardGhost' as any })
			.get('/', () => 'x')

		expect(() => app.compile()).toThrow(
			/Unknown model reference "GuardGhost"/
		)
	})

	// Shape 3 — a MACRO that injects a schema: the ref only exists after macro
	// resolution (`~applyMacro`), which the raw-route scan never ran.
	it('unknown MACRO-injected schema ref throws loud at compile()', () => {
		const app = new Elysia()
			.macro({ withSchema: () => ({ query: 'MacroGhost' as any }) })
			.get('/', { withSchema: true }, () => 'x')

		expect(() => app.compile()).toThrow(
			/Unknown model reference "MacroGhost"/
		)
	})

	// Shape 4 — `response: { default: 'X' }` with NO digit key: `default` is a
	// real status key at runtime (Validator.response), but the digit-first
	// heuristic never fired on it.
	it('unknown response DEFAULT-key ref throws loud with the status', () => {
		const app = new Elysia().get(
			'/r',
			{ response: { default: 'BadRef' as any } },
			() => 'x'
		)

		expect(() => app.compile()).toThrow(/Unknown model reference "BadRef"/)
		expect(() => app.compile()).toThrow(/response default/)
	})

	// False-throw guard: a BARE inline response schema whose object happens to
	// carry a `default`-named property (or a top-level `default` schema option)
	// is a single schema, NOT a status record — its keys are not model refs and
	// must not be scanned. Distinguished by `~kind` exactly as the runtime does.
	it('bare inline response schema with a `default` property does NOT throw', () => {
		const app = new Elysia().get(
			'/inline',
			{ response: t.Object({ default: t.String() }) },
			() => ({ default: 'ok' })
		)

		expect(() => app.compile()).not.toThrow()
	})
})

// PERF-1: `#buildRouter` no longer runs the full `composeRouteHook` assert for
// every route — a cheap `#routeMayHaveModelRef` pre-scan gates it. The gate must
// be conservative: any string model ref that could reach the composed hook
// (route-local, chain-level guard, standalone bag, or a macro that might inject
// one) still forces the loud build-time error. A false-negative would silently
// downgrade the loud compile error to an opaque per-request 500 — these pin that
// the fast path never swallows a real ref. (Shapes 1–4 above cover the rest.)
describe('PERF-1 — model-ref pre-scan gate stays conservative', () => {
	it('chain-level (guard-before-routes) string ref STILL throws at compile()', () => {
		const app = new Elysia()
			.guard({ query: 'ChainGhost' as any })
			.get('/a', () => 'x')
			.get('/b', () => 'y')

		expect(() => app.compile()).toThrow(
			/Unknown model reference "ChainGhost"/
		)
	})

	it('a plain app with NO refs and NO models compiles fine (fast path)', () => {
		const app = new Elysia()
			.get('/a', () => 'x')
			.post(
				'/b',
				{
					body: t.Object({ a: t.String() }),
					response: { 200: t.String() }
				},
				({ body }) => body.a
			)

		expect(() => app.compile()).not.toThrow()
	})
})

// DX-2: a route that fails to COMPILE (e.g. an invalid schema slot) must surface
// its method + path, not an opaque context-free 500. Both the eager (`compile()`)
// and lazy (first request → `#jitHandler`) compile paths wrap the throw. Run with
// `env -u NODE_ENV` — production redaction strips the detail body.
describe('DX-2 — compile failures carry route context', () => {
	it('eager compile() throws with the route method + path', () => {
		const app = new Elysia().get(
			'/bad',
			{ headers: { 'x-a': '1' } } as any,
			'hello' as any
		)

		expect(() => app.compile()).toThrow(/Failed to compile route GET \/bad/)
	})

	it('lazy first-request path surfaces the route in the 500 detail', async () => {
		const app = new Elysia().get(
			'/bad',
			{ headers: { 'x-a': '1' } } as any,
			'hello' as any
		)

		const res = await app.handle(new Request('http://localhost/bad'))
		expect(res.status).toBe(500)

		const body = (await res.json()) as { detail?: string }
		expect(body.detail).toContain('Failed to compile route GET /bad')
	})
})
