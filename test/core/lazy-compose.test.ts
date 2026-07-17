import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'

type Build = (
	opt: Record<string, unknown>
) => Elysia<any, any, any, any, any, any, any, any>

const eagerOpt = () => ({}) as Record<string, unknown>
const lazyOpt = () =>
	({ experimental: { lazyCompose: true } }) as Record<string, unknown>

const routeShape = (app: any) =>
	app.routes.map((r: any) => `${r.method} ${r.path}`)

const stripDate = (h: Headers) => {
	const out: Record<string, string> = {}
	for (const [k, v] of h) if (k.toLowerCase() !== 'date') out[k] = v
	return out
}

interface Req {
	method?: string
	path: string
	body?: unknown
	headers?: Record<string, string>
}

const send = (app: any, req: Req) => {
	const init: RequestInit = { method: req.method ?? 'GET' }
	if (req.headers) init.headers = req.headers
	if (req.body !== undefined) {
		init.body = JSON.stringify(req.body)
		init.headers = {
			'content-type': 'application/json',
			...(req.headers ?? {})
		}
	}
	return app.handle(new Request(`http://e.ly${req.path}`, init))
}

const assertParity = async (build: Build, matrix: Req[]) => {
	const eager = build(eagerOpt())
	const lazy = build(lazyOpt())

	expect(routeShape(lazy)).toEqual(routeShape(eager))

	for (const req of matrix) {
		const e = await send(eager, req)
		const l = await send(lazy, req)

		const eBody = await e.text()
		const lBody = await l.text()

		const tag = `${req.method ?? 'GET'} ${req.path}`
		expect(`${tag} :: ${l.status}`).toBe(`${tag} :: ${e.status}`)
		expect(`${tag} :: ${lBody}`).toBe(`${tag} :: ${eBody}`)
		expect(stripDate(l.headers)).toEqual(stripDate(e.headers))
	}
}

// parked: lazyCompose lane dropped pre-N+1; re-lands with the N+3a authoring DAG — see design/necessity-audit-2026-07-17.md
describe.skip('experimental.lazyCompose parity', () => {
	it('disabled mode keeps the baseline route table', () => {
		const app = new Elysia()
			.get('/a', () => 'a')
			.use(new Elysia({ prefix: '/p' }).get('/b', () => 'b'))
		expect(routeShape(app)).toEqual(['GET /a', 'GET /p/b'])
	})

	it('single sync plugin with a prefix', () =>
		assertParity(
			(opt) =>
				new Elysia(opt).use(
					new Elysia({ prefix: '/p', ...opt }).get('/x', () => 'x')
				),
			[{ path: '/p/x' }, { path: '/missing' }]
		))

	it('nested plugins depth 4 with prefixes and a global request hook', () =>
		assertParity(
			(opt) => {
				const l4 = new Elysia({ prefix: '/l4', ...opt })
					.request(({ set }: any) => {
						set.headers['x-depth'] = '4'
					})
					.get('/end', () => 'end')
				const l3 = new Elysia({ prefix: '/l3', ...opt })
					.use(l4)
					.get('/three', () => '3')
				const l2 = new Elysia({ prefix: '/l2', ...opt })
					.use(l3)
					.get('/two', () => '2')
				const l1 = new Elysia({ prefix: '/l1', ...opt })
					.use(l2)
					.get('/one', () => '1')
				return new Elysia(opt).use(l1).get('/root', () => 'root')
			},
			[
				{ path: '/l1/l2/l3/l4/end' },
				{ path: '/l1/l2/l3/three' },
				{ path: '/l1/l2/two' },
				{ path: '/l1/one' },
				{ path: '/root' }
			]
		))

	it('route registrations interleaved with `.use` preserve authoring order', () =>
		assertParity(
			(opt) => {
				const a = new Elysia({ prefix: '/a', ...opt }).get(
					'/x',
					() => 'ax'
				)
				const b = new Elysia({ prefix: '/b', ...opt }).get(
					'/y',
					() => 'by'
				)
				return new Elysia(opt)
					.get('/r1', () => 'r1')
					.use(a)
					.get('/r2', () => 'r2')
					.use(b)
					.get('/r3', () => 'r3')
			},
			[
				{ path: '/r1' },
				{ path: '/a/x' },
				{ path: '/r2' },
				{ path: '/b/y' },
				{ path: '/r3' }
			]
		))

	it('guard schema validation (accept + 422 reject) survives deferral', () =>
		assertParity(
			(opt) =>
				new Elysia(opt).use(
					new Elysia({ prefix: '/g', ...opt })
						.guard({ query: t.Object({ n: t.Numeric() }) })
						.get('/x', ({ query }: any) => query.n * 2)
				),
			[{ path: '/g/x?n=5' }, { path: '/g/x?n=abc' }, { path: '/g/x' }]
		))

	it('decorator, store and model reference validation across a plugin seam', () =>
		assertParity(
			(opt) =>
				new Elysia(opt).use(
					new Elysia({ prefix: '/p', ...opt })
						.decorate('dec', 42)
						.state('st', 'hello')
						.model({ Body: t.Object({ v: t.String() }) })
						.post(
							'/e',
							({ dec, store, body }: any) =>
								`${dec}-${store.st}-${JSON.stringify(body)}`,
							{ body: 'Body' }
						)
				),
			[
				{ method: 'POST', path: '/p/e', body: { v: 'ok' } },
				{ method: 'POST', path: '/p/e', body: { v: 123 } }
			]
		))

	it('macro fold-in propagates through deferral', () =>
		assertParity(
			(opt) =>
				new Elysia(opt).use(
					new Elysia({ prefix: '/m', ...opt })
						.macro({
							mark: (v: string) => ({
								beforeHandle({ set }: any) {
									set.headers['x-macro'] = v
								}
							})
						})
						.get('/x', () => 'x', { mark: 'yo' } as any)
				),
			[{ path: '/m/x' }]
		))

	it('scope-child macros reach routes registered after a nested lazy use', () =>
		assertParity(
			(opt) => {
				const seed = new Elysia(opt).get('/seed', () => 'seed')
				const plugin = new Elysia(opt)
					.use(seed)
					.get(
						'/target',
						{ mark: 'scoped' } as any,
						({ set }: any) => set.headers['x-mark'] ?? 'missing'
					)

				return new Elysia(opt).group('/g', (group: any) =>
					group
						.macro({
							mark: (value: string) => ({
								beforeHandle({ set }: any) {
									set.headers['x-mark'] = value
								}
							})
						})
						.use(plugin)
				)
			},
			[{ path: '/g/target' }]
		))

	it('scope-child (group + guard) inside a deferred plugin', () =>
		assertParity(
			(opt) =>
				new Elysia(opt)
					.use(
						new Elysia({ prefix: '/p', ...opt })
							.group('/admin', (app: any) =>
								app
									.guard({
										query: t.Object({ k: t.String() })
									})
									.get(
										'/dash',
										({ query }: any) => `dash-${query.k}`
									)
							)
							.get('/pub', () => 'pub')
					)
					.get('/r', () => 'r'),
			[
				{ path: '/p/admin/dash?k=hi' },
				{ path: '/p/admin/dash' },
				{ path: '/p/pub' },
				{ path: '/r' }
			]
		))

	it('named-plugin dedup / `use(self)` are unaffected', () =>
		assertParity(
			(opt) => {
				const named = new Elysia({ name: 'named', ...opt }).get(
					'/n',
					() => 'n'
				)
				const app = new Elysia(opt).use(named).use(named)
				app.use(app)
				return app.get('/tail', () => 'tail')
			},
			[{ path: '/n' }, { path: '/tail' }]
		))

	it('diamond reuse: one plugin used by two parents, itself nesting a plugin', () =>
		assertParity(
			(opt) => {
				const inner = new Elysia({ prefix: '/in', ...opt }).get(
					'/deep',
					() => 'deep'
				)
				const shared = new Elysia({ prefix: '/a', ...opt })
					.use(inner)
					.get('/x', () => 'ax')
				const p1 = new Elysia({ prefix: '/p1', ...opt })
					.use(shared)
					.get('/y', () => 'p1y')
				const p2 = new Elysia({ prefix: '/p2', ...opt })
					.use(shared)
					.get('/z', () => 'p2z')
				return new Elysia(opt).use(p1).use(p2)
			},
			[
				{ path: '/p1/a/in/deep' },
				{ path: '/p1/a/x' },
				{ path: '/p1/y' },
				{ path: '/p2/a/in/deep' },
				{ path: '/p2/a/x' },
				{ path: '/p2/z' }
			]
		))

	it('diamond where the shared child is flushed independently between uses', () =>
		assertParity(
			(opt) => {
				const inner = new Elysia({ prefix: '/in', ...opt }).get(
					'/deep',
					() => 'deep'
				)
				const shared = new Elysia({ prefix: '/a', ...opt })
					.use(inner)
					.get('/x', () => 'ax')
				const p1 = new Elysia({ prefix: '/p1', ...opt }).use(shared)
				void shared.routes.length
				const p2 = new Elysia({ prefix: '/p2', ...opt }).use(shared)
				return new Elysia(opt).use(p1).use(p2)
			},
			[
				{ path: '/p1/a/in/deep' },
				{ path: '/p1/a/x' },
				{ path: '/p2/a/in/deep' },
				{ path: '/p2/a/x' }
			]
		))

	it('functional `use(app => app.use(plugin))`', () =>
		assertParity(
			(opt) => {
				const plug = new Elysia({ prefix: '/f', ...opt }).get(
					'/fx',
					() => 'fx'
				)
				return new Elysia(opt)
					.use((app: any) => app.use(plug))
					.get('/r', () => 'r')
			},
			[{ path: '/f/fx' }, { path: '/r' }]
		))

	it('a child mutated after `.use` does not add its later routes', () =>
		assertParity(
			(opt) => {
				const child = new Elysia({ prefix: '/c', ...opt }).get(
					'/early',
					() => 'early'
				)
				const root = new Elysia(opt).use(child)
				child.get('/late', () => 'late')
				return root
			},
			[{ path: '/c/early' }, { path: '/c/late' }]
		))

	it('history reflects the flushed table on either mode', () => {
		const build = (opt: Record<string, unknown>) =>
			new Elysia(opt)
				.get('/r', () => 'r')
				.use(new Elysia({ prefix: '/p', ...opt }).get('/x', () => 'x'))

		const eager = build(eagerOpt())
		const lazy = build(lazyOpt())

		const shape = (a: any) =>
			a.history.map((h: any) => `${h.method} ${h.path}`)
		expect(shape(lazy)).toEqual(shape(eager))
		expect(shape(lazy)).toEqual(['GET /r', 'GET /p/x'])
	})
})

// parked: lazyCompose lane dropped pre-N+1; re-lands with the N+3a authoring DAG — see design/necessity-audit-2026-07-17.md
describe.skip('experimental.lazyCompose unsupported plugins', () => {
	it('`.use(Promise)` throws naming the flag', () => {
		expect(() =>
			new Elysia({ experimental: { lazyCompose: true } }).use(
				Promise.resolve(new Elysia())
			)
		).toThrow(/lazyCompose/)
	})

	it('async plugin function throws naming the flag', () => {
		expect(() =>
			new Elysia({ experimental: { lazyCompose: true } }).use(
				async (app: any) => app
			)
		).toThrow(/lazyCompose/)
	})

	it('a pending (async) plugin throws naming the flag', () => {
		const pending = new Elysia().use(Promise.resolve(new Elysia()))
		expect(() =>
			new Elysia({ experimental: { lazyCompose: true } }).use(pending)
		).toThrow(/lazyCompose/)
	})

	it('the same async constructs are accepted when the flag is off', async () => {
		const app = new Elysia()
			.use(Promise.resolve(new Elysia().get('/p', () => 'p')))
			.use(async (a: any) => a.get('/f', () => 'f'))
		await app.modules
		expect(routeShape(app).sort()).toEqual(['GET /f', 'GET /p'])
	})
})

// parked: lazyCompose lane dropped pre-N+1; re-lands with the N+3a authoring DAG — see design/necessity-audit-2026-07-17.md
describe.skip('experimental.lazyCompose deep plugin chains', () => {
	it('builds a deep chain within the lazy cost ceiling', () => {
		const DEPTH = 64
		const PER_LEVEL = 4 // ~256 routes, D deep — the reabsorption stress shape

		const build = (opt: Record<string, unknown>) => {
			let node: any = new Elysia(opt)
			for (let r = 0; r < PER_LEVEL; r++)
				node = node.get(`/leaf${r}`, () => r)

			for (let d = 0; d < DEPTH; d++) {
				let parent: any = new Elysia({ prefix: `/l${d}`, ...opt })
				parent = parent.use(node)
				for (let r = 0; r < PER_LEVEL; r++)
					parent = parent.get(`/own${d}_${r}`, () => r)
				node = parent
			}
			void node.routes.length // force build/flush
			return node
		}

		build(eagerOpt())
		build(lazyOpt())

		const time = (opt: Record<string, unknown>) => {
			let best = Infinity
			let routes = 0
			for (let i = 0; i < 5; i++) {
				const t0 = performance.now()
				const app = build(opt)
				best = Math.min(best, performance.now() - t0)
				routes = (app as any).routes.length
			}
			return { ms: best, routes }
		}

		const eager = time(eagerOpt())
		const lazy = time(lazyOpt())

		expect(lazy.routes).toBe(eager.routes)
		expect(lazy.ms).toBeLessThan(eager.ms * 0.6)
	})
})
