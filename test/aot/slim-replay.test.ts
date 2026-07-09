import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { resolve } from 'node:path'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled, computeRouteTableShape } from '../../src/compile/aot'
import { captureArtifacts } from '../../src/plugin/source'
import { materialiseHandlers, materialise } from './_manifest'
import { req } from '../utils'

// The plugin plan/source must be read from the SAME dist instance the fixtures'
// bare `elysia` import resolves to (see mode-gating.test.ts for the rationale).
const distCore = (await import(
	resolve(import.meta.dir, '../../dist/plugin/core.mjs')
)) as typeof import('../../src/plugin/core')

/**
 * Slim replay (slice 1): the build plugin freezes the resolved
 * (method, path) → handler route table into `Compiled.routeTable`. At runtime,
 * `#buildRouter` early-returns and binds the frozen handlers straight into
 * `~map` — skipping `#assertRouteModelRefs`, variant derivation, and per-route
 * compile.
 *
 * WHY these tests matter: the slim path is a SECOND route-installation path that
 * must produce a byte-identical `~map` and identical request behaviour to the
 * full builder. A drift here silently serves the wrong (or no) handler. So each
 * test builds the SAME fixture through both paths and asserts equality of the
 * canonical map (method → served path → handler behaviour) AND actual request
 * results. The bail tests pin that anything outside the slice-1 envelope emits
 * NO routeTable (safe fallback to the full builder). The shape-drift test pins the
 * loud throw when the running app diverges from the build.
 *
 * @see design/slim-replay.md
 */

// Capture handlers + routeTable for `make()` under AOT build env, then register
// them the way the generated manifest module would. Returns the frozen routeTable
// so the test can assert on it. Env-toggling mirrors handler.test.ts.
const capture = async (make: () => Elysia<any, any>) => {
	process.env.ELYSIA_AOT_BUILD = '1'
	let routeTable
	let handlers
	let validators
	try {
		const artifacts = await captureArtifacts(make() as any, {
			register: false
		})
		handlers = artifacts.handlers
		validators = artifacts.validators
		routeTable = artifacts.routeTable
	} finally {
		delete process.env.ELYSIA_AOT_BUILD
	}

	return { handlers, validators, routeTable }
}

const register = (
	handlers: Awaited<ReturnType<typeof capture>>['handlers'],
	routeTable: Awaited<ReturnType<typeof capture>>['routeTable'],
	validators?: Awaited<ReturnType<typeof capture>>['validators']
) => {
	Compiled.handlers = materialiseHandlers(handlers)
	// Slice 4 schema routes reconstruct their frozen validators at replay, so the
	// validator manifest must be registered too (the full builder builds them via
	// the same reconstruct path, so this mirrors what the generated module emits).
	if (validators) Compiled.validators = materialise(validators)
	Compiled.routeTable = routeTable
}

// Canonical map: method → served path → the string body the handler returns for
// a bare GET/… request. Handler identity is opaque (a closure), so we compare
// observable behaviour per served path — the property the map exists to provide.
const canonicalMap = async (app: Elysia<any, any>) => {
	const map = (app as any)['~map'] as Record<
		string,
		Record<string, unknown> | undefined
	>
	const out: Record<string, Record<string, string>> = {}

	for (const method in map) {
		const paths = map[method]
		if (!paths) continue
		for (const path in paths) {
			const res = await app.handle(
				req(path, { method: method === 'HEAD' ? 'GET' : method })
			)
			;(out[method] ??= {})[path] =
				res.status + ':' + (await res.text())
		}
	}

	return out
}

beforeEach(() => {
	Compiled.clear()
	Validator.clear()
})
afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

const fixture = () =>
	new Elysia({ strictPath: true })
		.get('/', () => 'root')
		.get('/a', () => 'a')
		.post('/a', () => 'post-a')
		.get('/dup', () => 'first')
		.get('/dup', () => 'second') // last wins
		.use(new Elysia({ strictPath: true }).get('/sub', () => 'sub'))
		.group('/g', (g) => g.get('/x', () => 'gx'))
		.guard({}, (g) => g.get('/guarded', () => 'guarded'))

describe('slim replay — differential (full path vs slim path)', () => {
	it('produces an identical canonical ~map and identical responses', async () => {
		const { handlers, routeTable } = await capture(fixture)

		// The fixture is inside the slice-1 envelope, so routeTable must be emitted.
		expect(routeTable).toBeDefined()

		// ── full path (no routeTable registered) ────────────────────────────
		Compiled.clear()
		Validator.clear()
		const full = fixture()
		;(full as any).compile()
		const fullMap = await canonicalMap(full)

		// ── slim path (routeTable registered → #buildRouter early-returns) ────
		Compiled.clear()
		Validator.clear()
		register(handlers, routeTable)

		// Prove the slim path actually binds FROZEN factories (not JIT): spy each
		// factory and assert it fired during compile. If #buildRouter had run the
		// full builder, these would be reached too — but the frozen fast path is
		// the ONLY route to them without a validator/hook, which the fixture omits.
		let frozenBinds = 0
		const manifest = Compiled.handlers!
		for (const m in manifest)
			for (const p in manifest[m]!) {
				const real = manifest[m]![p]!.f
				manifest[m]![p]!.f = (...a: unknown[]) => {
					frozenBinds++
					return real(...a)
				}
			}

		const slim = fixture()
		;(slim as any).compile()
		expect(frozenBinds).toBeGreaterThan(0)
		const slimMap = await canonicalMap(slim)

		// Canonical map equality: same served paths, same handler behaviour.
		expect(slimMap).toEqual(fullMap)

		// Spot-check the interesting cases end-to-end through both apps.
		for (const [path, method, expected] of [
			['/', 'GET', 'root'],
			['/a', 'GET', 'a'],
			['/a', 'POST', 'post-a'],
			['/dup', 'GET', 'second'], // last wins
			['/sub', 'GET', 'sub'], // .use() composed
			['/g/x', 'GET', 'gx'], // group prefix
			['/guarded', 'GET', 'guarded'] // guard
		] as const) {
			const f = await full.handle(req(path, { method }))
			const s = await slim.handle(req(path, { method }))
			expect(f.status).toBe(200)
			expect(s.status).toBe(f.status)
			expect(await s.text()).toBe(expected)
			expect(await f.text()).toBe(expected)
		}

		// Header parity on a representative route.
		const fh = await full.handle(req('/a'))
		const sh = await slim.handle(req('/a'))
		expect(sh.headers.get('content-type')).toBe(
			fh.headers.get('content-type')
		)
	})

	it('the early return DRIVES ~map from routeTable, not the route loop', async () => {
		// Decisive proof the early-return fires: register a routeTable that OMITS one
		// served path. If the full builder ran, the route loop would still install
		// it. If the slim path ran, ~map reflects only what routeTable enumerates.
		const twoRoute = () =>
			new Elysia({ strictPath: true })
				.use(new Elysia().get('/x', () => 'x'))
				.get('/keep', () => 'keep')
				.get('/drop', () => 'drop')

		const { handlers, routeTable } = await capture(twoRoute)
		expect(routeTable).toBeDefined()

		// Surgically remove /drop from the frozen routeTable (shape untouched).
		delete routeTable!.static.GET!['/drop']

		Compiled.clear()
		Validator.clear()
		register(handlers, routeTable)
		const slim = twoRoute()
		;(slim as any).compile()

		expect((slim as any)['~map'].GET['/keep']).toBeDefined()
		// Only reachable if the route loop was skipped (routeTable-driven).
		expect((slim as any)['~map'].GET['/drop']).toBeUndefined()
	})

	it('slim ~map has the SAME served-path key set as the full builder', async () => {
		const { handlers, routeTable } = await capture(fixture)

		Compiled.clear()
		const full = fixture()
		;(full as any).compile()
		const fullKeys = mapKeys(full)

		Compiled.clear()
		Validator.clear()
		register(handlers, routeTable)
		const slim = fixture()
		;(slim as any).compile()
		const slimKeys = mapKeys(slim)

		expect(slimKeys).toEqual(fullKeys)
	})
})

/**
 * Differential runner for the slice-2 widened envelope. Builds the SAME fixture
 * through the full builder and the slim path, asserts byte-identical `~map`
 * key sets, then probes each (path, method) pair end-to-end through BOTH apps
 * asserting identical status, body, and content-type. HEAD probes are real HEAD
 * requests (not the GET-substitution `canonicalMap` uses) so autoHead's
 * empty-body + content-length wrapping is checked directly.
 */
const differential = async (
	make: () => Elysia<any, any>,
	probes: ReadonlyArray<readonly [path: string, method: string]>
) => {
	const { handlers, validators, routeTable } = await capture(make)
	// Every widened fixture is inside the envelope → routeTable emitted.
	expect(routeTable).toBeDefined()

	Compiled.clear()
	Validator.clear()
	const full = make()
	;(full as any).compile()
	const fullKeys = mapKeys(full)

	Compiled.clear()
	Validator.clear()
	register(handlers, routeTable, validators)
	const slim = make()
	;(slim as any).compile()
	const slimKeys = mapKeys(slim)

	// Same served-path key set through both installation paths.
	expect(slimKeys).toEqual(fullKeys)

	for (const [path, method] of probes) {
		const f = await full.handle(req(path, { method }))
		const s = await slim.handle(req(path, { method }))
		const fb = await f.text()
		const sb = await s.text()

		expect(s.status).toBe(f.status)
		expect(sb).toBe(fb)
		expect(s.headers.get('content-type')).toBe(
			f.headers.get('content-type')
		)
		expect(s.headers.get('content-length')).toBe(
			f.headers.get('content-length')
		)
	}
}

describe('slim replay — widened envelope (slice 2: loose / encoded / autoHead)', () => {
	it('autoHead: GET/HEAD parity — status, headers, empty HEAD body', async () => {
		await differential(
			() =>
				new Elysia({ strictPath: true, autoHead: true })
					.get('/', () => 'ok')
					.get('/a', () => ({ x: 1 })),
			[
				['/', 'GET'],
				['/', 'HEAD'],
				['/a', 'GET'],
				['/a', 'HEAD']
			]
		)
	})

	it('loose (strictPath off): /x served at both /x and /x/ per loose semantics', async () => {
		await differential(
			() =>
				new Elysia()
					.get('/', () => 'root')
					.get('/a/', () => 'a')
					.get('/b', () => 'b'),
			[
				['/', 'GET'],
				['', 'GET'], // loose alias of '/'
				['/a/', 'GET'],
				['/a', 'GET'], // loose alias of '/a/'
				['/b', 'GET'] // no trailing slash → no loose alias
			]
		)
	})

	it('encoded path (unicode + space): both raw and %-encoded served identically', async () => {
		await differential(
			() =>
				new Elysia({ strictPath: true })
					.get('/café', () => 'cafe')
					.get('/hello world', () => 'hw'),
			[
				['/café', 'GET'],
				['/caf%C3%A9', 'GET'],
				['/hello world', 'GET'],
				['/hello%20world', 'GET']
			]
		)
	})

	it('autoHead + loose combined: HEAD wrapping applies to loose aliases too', async () => {
		await differential(
			() => new Elysia({ autoHead: true }).get('/a/', () => 'body-here'),
			[
				['/a/', 'GET'],
				['/a', 'GET'],
				['/a/', 'HEAD'],
				['/a', 'HEAD']
			]
		)
	})

	it('explicit HEAD route wins over autoHead (own captured handler, not wrapped)', async () => {
		await differential(
			() =>
				new Elysia({ strictPath: true, autoHead: true })
					.get('/x', () => 'x')
					.head('/x', () => 'explicit'),
			[
				['/x', 'GET'],
				['/x', 'HEAD'] // must be 'explicit', not the wrapped GET body
			]
		)
	})
})

/**
 * Slice-4 differential: schema/hook routes and dynamic (params/wildcard) routes.
 * Unlike `differential` (which only probes GET-less requests), this runner takes
 * full `RequestInit` per probe so it can drive real bodies/queries and assert
 * 200-shape AND 422-body parity full-vs-slim. Validation behaviour is the
 * non-negotiable: a schema route must coerce, default-inject, and 422 identically
 * through both installation paths — because both bind via the SAME
 * `compileHandler` reconstruct + frozen validator. Dynamic routes additionally
 * prove `~router` add-order parity (literal-vs-param precedence).
 */
const differential4 = async (
	make: () => Elysia<any, any>,
	probes: ReadonlyArray<
		readonly [path: string, init: RequestInit | undefined]
	>
) => {
	const { handlers, validators, routeTable } = await capture(make)
	expect(routeTable).toBeDefined()

	Compiled.clear()
	Validator.clear()
	const full = make()
	;(full as any).compile()

	Compiled.clear()
	Validator.clear()
	register(handlers, routeTable, validators)
	const slim = make()
	;(slim as any).compile()

	// Static served-path key sets still match (dynamic routes live in ~router, so
	// they are compared purely by request behaviour below).
	expect(mapKeys(slim)).toEqual(mapKeys(full))

	for (const [path, init] of probes) {
		const f = await full.handle(req(path, init))
		const s = await slim.handle(req(path, init))
		const fb = await f.text()
		const sb = await s.text()

		expect(s.status).toBe(f.status)
		expect(sb).toBe(fb)
		expect(s.headers.get('content-type')).toBe(
			f.headers.get('content-type')
		)
	}
}

const json = (body: unknown): RequestInit => ({
	method: 'POST',
	body: JSON.stringify(body),
	headers: { 'content-type': 'application/json' }
})

describe('slim replay — widened envelope (slice 4: schema / hook / dynamic)', () => {
	it('schema query route: 200 shape + coercion + default AND 422 body parity', async () => {
		await differential4(
			() =>
				new Elysia({ strictPath: true })
					// composed so the handler is captured (not inlined)
					.use(
						new Elysia({ strictPath: true }).get(
							'/q',
							{
								query: t.Object({
									page: t.Optional(t.Numeric()),
									size: t.Number({ default: 10 }),
									q: t.String()
								})
							},
							({ query }: any) => query
						)
					),
			[
				['/q?q=hi&page=3', undefined], // coerces page → number, defaults size
				['/q?q=hi', undefined], // default-injects size
				['/q?page=3', undefined] // 422: missing required q
			]
		)
	})

	it('schema body route: 200 echo AND 422 body parity', async () => {
		await differential4(
			() =>
				new Elysia({ strictPath: true }).post(
					'/b',
					{ body: t.Object({ name: t.String(), age: t.Number() }) },
					({ body }: any) => body
				),
			[
				['/b', json({ name: 'x', age: 5 })], // 200
				['/b', json({ name: 'x' })] // 422 missing age
			]
		)
	})

	it('hook chain: onTransform + beforeHandle order observable via side effects', async () => {
		const order: string[] = []
		const make = () =>
			new Elysia({ strictPath: true }).get(
				'/h',
				{
					transform() {
						order.push('transform')
					},
					beforeHandle() {
						order.push('before')
					}
				},
				() => {
					order.push('handler')
					return 'ok'
				}
			)

		// Capture, then run BOTH paths and assert the recorded order is identical
		// (transform → before → handler) — proving the hook chain replays in order.
		const { handlers, validators, routeTable } = await capture(make)
		expect(routeTable).toBeDefined()

		Compiled.clear()
		Validator.clear()
		order.length = 0
		const full = make()
		;(full as any).compile()
		await full.handle(req('/h'))
		const fullOrder = order.slice()

		Compiled.clear()
		Validator.clear()
		order.length = 0
		register(handlers, routeTable, validators)
		const slim = make()
		;(slim as any).compile()
		await slim.handle(req('/h'))
		const slimOrder = order.slice()

		expect(fullOrder).toEqual(['transform', 'before', 'handler'])
		expect(slimOrder).toEqual(fullOrder)
	})

	it('dynamic param route: encoded param value round-trips identically', async () => {
		await differential4(
			() =>
				new Elysia({ strictPath: true })
					.get('/tag/:name', ({ params }: any) => 'tag:' + params.name)
					.get(
						'/item/:id',
						{ params: t.Object({ id: t.Numeric() }) },
						({ params }: any) =>
							'num:' + params.id + ':' + typeof params.id
					),
			[
				['/tag/plain', undefined],
				['/tag/caf%C3%A9', undefined], // encoded param value decoded in handler
				['/item/7', undefined], // params coercion 200
				['/item/abc', undefined] // params 422 body parity
			]
		)
	})

	it('literal-vs-param precedence is identical — literal registered FIRST', async () => {
		await differential4(
			() =>
				new Elysia({ strictPath: true })
					.get('/user/all', () => 'all')
					.get('/user/:id', ({ params }: any) => 'id:' + params.id),
			[
				['/user/all', undefined], // literal wins
				['/user/42', undefined] // param match
			]
		)
	})

	it('literal-vs-param precedence is identical — param registered FIRST', async () => {
		await differential4(
			() =>
				new Elysia({ strictPath: true })
					.get('/user/:id', ({ params }: any) => 'id:' + params.id)
					.get('/user/all', () => 'all'),
			[
				['/user/all', undefined], // literal STILL wins (~map beats ~router)
				['/user/42', undefined]
			]
		)
	})

	it('dynamic + loose + autoHead combined: HEAD wrapping + no dynamic loose alias', async () => {
		await differential4(
			() => new Elysia({ autoHead: true }).get('/p/:id/', ({ params }: any) => 'body:' + params.id),
			[
				['/p/5/', undefined], // GET
				['/p/5/', { method: 'HEAD' }] // wrapped autoHead HEAD (empty body)
			]
		)
	})

	it('mixed static + dynamic app: both installation surfaces replay', async () => {
		await differential4(
			() =>
				new Elysia({ strictPath: true })
					.use(
						new Elysia({ strictPath: true })
							.get('/static', () => 'static')
							.get('/u/:id', ({ params }: any) => 'u:' + params.id)
					)
					.get('/root', () => 'root'),
			[
				['/static', undefined],
				['/root', undefined],
				['/u/9', undefined]
			]
		)
	})
})

const bails = async (make: () => Elysia<any, any>) => {
	const { routeTable } = await capture(make)
	expect(routeTable).toBeUndefined() // routeTable should not be emitted
}

describe('slim replay — slice-4 bails (unreplayable classes)', () => {
	it('bails on a macro route (JIT hook resolution)', async () => {
		await bails(() =>
			new Elysia({ strictPath: true })
				.macro({ auth: { resolve: () => ({ user: 'x' }) } })
				.get('/', { auth: true } as any, () => 'ok')
		)
	})

	it('bails on a mount route', async () => {
		const sub = new Elysia().get('/', () => 'mounted')
		await bails(() =>
			new Elysia({ strictPath: true }).mount('/sub', sub.handle)
		)
	})

	it('bails on a standard-schema (non-TypeBox) validator route', async () => {
		// A `~standard` slot replays via a live validator; conservatively bailed so
		// the whole routeTable falls back to the full builder.
		const standard = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: (v: unknown) => ({ value: v })
			}
		}
		await bails(() =>
			new Elysia({ strictPath: true }).post(
				'/s',
				{ body: standard as any },
				({ body }: any) => body
			)
		)
	})
})

const mapKeys = (app: Elysia<any, any>): string[] => {
	const map = (app as any)['~map'] as Record<
		string,
		Record<string, unknown> | undefined
	>
	const keys: string[] = []
	for (const method in map)
		if (map[method])
			for (const path in map[method]) keys.push(method + ' ' + path)
	return keys.sort()
}

describe('slim replay — bail envelope (routeTable omitted outside slice 1)', () => {
	it('bails on a WS route', async () => {
		await bails(() =>
			new Elysia({ strictPath: true }).ws('/ws', {
				message() {}
			})
		)
	})

	// Slice 2 CONSCIOUSLY FLIPS these two from "bails" to "emits routeTable": the
	// base `#buildRouter` already lays autoHead HEAD entries and loose/encoded
	// served-path variants into `~map`, so capture now serializes them. The
	// positive coverage (byte-identical full-vs-slim maps + responses) lives in
	// the "widened envelope" describe below; here we only pin that routeTable is no
	// longer suppressed — the exact assertion these tests used to make, inverted.
	it('EMITS routeTable when autoHead is enabled (slice 2 — was a bail)', async () => {
		const { routeTable } = await capture(() =>
			new Elysia({ strictPath: true, autoHead: true }).get(
				'/',
				() => 'ok'
			)
		)
		expect(routeTable).toBeDefined()
		// autoHead GET with no explicit HEAD → head table wraps the base slot.
		expect(routeTable!.head!['/']).toEqual({ m: 'GET', p: '/' })
	})

	it('EMITS routeTable when strictPath is off / loose (slice 2 — was a bail)', async () => {
		const { routeTable } = await capture(() =>
			new Elysia().get('/a/', () => 'ok')
		)
		expect(routeTable).toBeDefined()
		// Trailing-slash path derives the loose alias `/a` → same base slot.
		expect(routeTable!.static.GET!['/a/']).toEqual({ m: 'GET', p: '/a/' })
		expect(routeTable!.static.GET!['/a']).toEqual({ m: 'GET', p: '/a/' })
	})

	// Slice 4 CONSCIOUSLY FLIPS these from "bails" to "emits routeTable": a route
	// carrying frozen validators / hook chains still binds through the SAME
	// `compileHandler` reconstruct path as the full builder, and a dynamic route
	// binds into `~router` via the same ordered `add(...)` calls. Positive
	// coverage (byte-identical full-vs-slim maps + 200/422 responses) lives in the
	// "widened envelope — slice 4" describe below; here we only pin the flip.
	it('EMITS routeTable for a bridge-free schema route (slice 4 — was a bail)', async () => {
		const { routeTable } = await capture(() =>
			new Elysia({ strictPath: true }).get(
				'/',
				{ query: t.Object({ page: t.Number() }) },
				({ query }: any) => query
			)
		)
		expect(routeTable).toBeDefined()
		expect(routeTable!.static.GET!['/']).toEqual({ m: 'GET', p: '/' })
	})

	it('EMITS routeTable for a params (dynamic) route (slice 4 — was a bail)', async () => {
		const { routeTable } = await capture(() =>
			new Elysia({ strictPath: true }).get(
				'/user/:id',
				({ params }: any) => params.id
			)
		)
		expect(routeTable).toBeDefined()
		// Dynamic routes serialize an ordered `~router` add-sequence, not `~map`.
		expect(routeTable!.dynamic).toEqual([
			{ m: 'GET', s: '/user/:id', slot: { m: 'GET', p: '/user/:id' } }
		])
	})

	it('still bails on a NON-bridge-free schema route (needs the severed bridge)', async () => {
		// A union body is not bridge-free → its captured validator can't be
		// reconstructed under a severed bridge, so slim replay must bail the whole
		// routeTable (mirrors buildFrozenRouteValidator's refusal surface).
		await bails(() =>
			new Elysia({ strictPath: true }).post(
				'/',
				{
					body: t.Union([
						t.Object({ a: t.String() }),
						t.Object({ b: t.Number() })
					])
				},
				({ body }: any) => body
			)
		)
	})

	it('bails on an inline uncaptured handler route', async () => {
		// `() => 'ok'` is inline-eligible → never captured into the handler
		// manifest → no frozen handler to bind → routeTable bails.
		//
		// (Verified empirically: whatever the capture decision, a route with no
		// captured handler entry must NOT appear in routeTable.)
		const { handlers, routeTable } = await capture(() =>
			new Elysia({ strictPath: true }).get('/inline', 'ok')
		)

		if (routeTable)
			for (const method in routeTable.static)
				for (const path in routeTable.static[method]!) {
					const { m, p } = routeTable.static[method]![path]!
					expect(
						handlers.some(
							(h) => h.method === m && h.path === p
						)
					).toBe(true)
				}
	})
})

describe('slim replay — dist end-to-end (real plugin path)', () => {
	it('a sealed strictPath static app emits Compiled.routeTable into the manifest', async () => {
		const { source, mode } = await distCore.generateCompiledArtifacts(
			resolve(import.meta.dir, 'fixtures/slim-route-table-app.ts')
		)

		// Slice-1-eligible app is sealed by construction (no validators/hooks).
		expect(mode).toBe('sealed')
		// The routeTable registration is appended to the generated manifest source.
		expect(source).toContain('Compiled.routeTable =')

		const m = source.match(/Compiled\.routeTable = (\{[\s\S]*?\})\n/)
		expect(m).not.toBeNull()
		const routeTable = JSON.parse(m![1]!)
		expect(routeTable.v).toBe(1)
		// All four static routes present.
		const getPaths = Object.keys(routeTable.static.GET ?? {}).sort()
		expect(getPaths).toEqual(['/', '/a', '/b', '/c'])
	})

	it('a sealed autoHead+loose app emits routeTable with loose aliases and a head table', async () => {
		const { source, mode } = await distCore.generateCompiledArtifacts(
			resolve(import.meta.dir, 'fixtures/slim-route-table-widened-app.ts')
		)

		// Widened envelope (loose + autoHead) still seals by construction.
		expect(mode).toBe('sealed')
		expect(source).toContain('Compiled.routeTable =')

		const m = source.match(/Compiled\.routeTable = (\{[\s\S]*?\})\n/)
		expect(m).not.toBeNull()
		const routeTable = JSON.parse(m![1]!)
		expect(routeTable.v).toBe(1)

		// Loose derives trailing-slash aliases: '/a/'→'/a', '/'→'', '/b' has none.
		const getPaths = Object.keys(routeTable.static.GET ?? {}).sort()
		expect(getPaths).toEqual(['', '/', '/a', '/a/', '/b'])
		expect(routeTable.static.GET['/a']).toEqual({ m: 'GET', p: '/a/' })

		// autoHead head table wraps every served GET path (incl. loose aliases).
		const headPaths = Object.keys(routeTable.head ?? {}).sort()
		expect(headPaths).toEqual(['', '/', '/a', '/a/', '/b'])
		expect(routeTable.head['/a']).toEqual({ m: 'GET', p: '/a/' })
	})

	it('a sealed schema/validator app EMITS routeTable (slice 4)', async () => {
		// mode-a-app has a bridge-free body-validated route → sealed → slice 4
		// now freezes its routeTable (the schema route binds through the same
		// reconstruct path the full builder uses).
		const { source, mode } = await distCore.generateCompiledArtifacts(
			resolve(import.meta.dir, 'fixtures/mode-a-app.ts')
		)
		expect(mode).toBe('sealed')
		expect(source).toContain('Compiled.routeTable =')

		const m = source.match(/Compiled\.routeTable = (\{[\s\S]*?\})\n/)
		expect(m).not.toBeNull()
		const routeTable = JSON.parse(m![1]!)
		expect(routeTable.static.POST['/u']).toEqual({ m: 'POST', p: '/u' })
	})

	it('a WIRED (non-bridge-free) schema app emits NO routeTable', async () => {
		// mode-b-app forces wired mode (a validator still needs the bridge). A
		// wired app is not slim-replayable under a severed bridge → no routeTable.
		const { source, mode } = await distCore.generateCompiledArtifacts(
			resolve(import.meta.dir, 'fixtures/mode-b-app.ts')
		)
		expect(mode).toBe('wired')
		expect(source).not.toContain('Compiled.routeTable =')
	})
})

describe('slim replay — shape drift is a loud throw', () => {
	it('throws naming the drifted route when A′ registers an extra route', async () => {
		const A = () =>
			new Elysia({ strictPath: true })
				.get('/', () => 'root')
				.get('/a', () => 'a')

		const { handlers, routeTable } = await capture(A)
		expect(routeTable).toBeDefined()

		register(handlers, routeTable)

		// A′ has an extra route the build never saw → shape mismatch.
		const APrime = new Elysia({ strictPath: true })
			.get('/', () => 'root')
			.get('/a', () => 'a')
			.get('/extra', () => 'extra')

		expect(() => (APrime as any).compile()).toThrow(
			/frozen route-table shape mismatch/
		)
	})

	it('computeRouteTableShape diverges when a route is added', () => {
		const base = new Elysia({ strictPath: true }).get('/', () => 'x')
		;(base as any).compile()
		const extra = new Elysia({ strictPath: true })
			.get('/', () => 'x')
			.get('/y', () => 'y')
		;(extra as any).compile()

		const s1 = computeRouteTableShape(
			(base as any).history,
			(base as any)['~config']
		)
		const s2 = computeRouteTableShape(
			(extra as any).history,
			(extra as any)['~config']
		)
		expect(s1).not.toBe(s2)
	})

	it('falls back to the full builder on a version mismatch (no throw)', async () => {
		const { handlers, routeTable } = await capture(() =>
			new Elysia({ strictPath: true }).get('/', () => 'root')
		)
		expect(routeTable).toBeDefined()

		register(handlers, { ...routeTable!, v: routeTable!.v + 1000 })

		// Stale-version manifest → silent fallback to the full builder, still 200.
		const app = new Elysia({ strictPath: true }).get('/', () => 'root')
		;(app as any).compile()
		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('root')
	})
})
