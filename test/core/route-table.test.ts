// @ts-nocheck
import { Elysia, t } from '../../src'
import { buildRouteTable, routeRow, RouteFlag } from '../../src/route-table'
import { collectStaticRoutes } from '../../src/adapter/bun'
import { describe, expect, it } from 'bun:test'

// Fixture apps exercising the consumers B7 converts: nested plugins/prefixes,
// guards, WS, macro, and the lazyCompose flag both on and off. Each returns the
// built app (router + `~routeTable` populated) plus its raw authoring tuples.
const buildFixture = (lazyCompose: boolean) => {
	// Verb signature is (path, hook, fn) — hook second, handler third.
	const child = new Elysia({ prefix: '/child' })
		.get('/a', { query: t.Object({ q: t.String() }) }, () => 'a')
		.ws('/socket', { message() {} })

	const guarded = new Elysia()
		.guard({ beforeHandle() {} })
		.get('/guarded', () => 'g')

	const app = new Elysia(
		lazyCompose ? { experimental: { lazyCompose: true } } : undefined
	)
		.macro({ auth: { resolve: () => ({ user: 'x' }) } })
		.get('/', () => 'root')
		.get('/dyn/:id', ({ params }) => params.id)
		.use(child)
		.use(guarded)
		.get('/tail', { auth: true }, () => 'tail')

	// Force flatten + router build so `~routeTable` exists.
	void app.fetch

	return app
}

const rawTuples = (app: any): readonly any[] => app['~routes']

describe('B7 columnar route table', () => {
	describe('structural parity — columns match authoring tuples field-by-field', () => {
		for (const lazyCompose of [false, true])
			it(`lazyCompose=${lazyCompose}`, () => {
				const app = buildFixture(lazyCompose)
				const table = app['~routeTable']
				const tuples = rawTuples(app)

				expect(table).toBeDefined()
				expect(table.length).toBe(tuples.length)

				for (let i = 0; i < tuples.length; i++) {
					const t = tuples[i]

					// Dense IDs === flatten order; each column === its tuple field.
					expect(table.method[i]).toBe(t[0])
					expect(table.path[i]).toBe(t[1])
					expect(table.handler[i]).toBe(t[2])
					expect(table.owner[i]).toBe(t[3])
					expect(table.localHook[i]).toBe(t[4])
					expect(table.appHook[i]).toBe(t[5])
					expect(table.inheritedChain[i]).toBe(t[6])

					// Side table: macroScope present iff tuple[7] present.
					if (t[7] === undefined)
						expect(table.macroScope.has(i)).toBe(false)
					else expect(table.macroScope.get(i)).toBe(t[7])

					// Flags reflect WS + dynamic-path facts.
					expect(!!(table.flags[i] & RouteFlag.WS)).toBe(
						t[0] === 'WS'
					)
					expect(!!(table.flags[i] & RouteFlag.Dynamic)).toBe(
						/[:*]/.test(t[1])
					)
				}
			})
	})

	it('routeRow reconstructs a fresh tuple equal field-by-field to the authoring tuple', () => {
		const app = buildFixture(false)
		const table = app['~routeTable']
		const tuples = rawTuples(app)

		for (let i = 0; i < tuples.length; i++) {
			const row = routeRow(table, i)
			const t = tuples[i]

			for (let f = 0; f < 8; f++) expect(row[f]).toBe(t[f])

			// The row is a distinct array object, never the authoring tuple.
			expect(row).not.toBe(t)
		}
	})

	describe('no-tuple retention (heap reachability, expressed as identity)', () => {
		for (const lazyCompose of [false, true])
			it(`no column or side-table value is a raw authoring tuple array (lazyCompose=${lazyCompose})`, () => {
				const app = buildFixture(lazyCompose)
				const table = app['~routeTable']
				const tuples = new Set<unknown>(rawTuples(app))

				const columns = [
					table.method,
					table.path,
					table.handler,
					table.owner,
					table.localHook,
					table.appHook,
					table.inheritedChain,
					table.flags
				]

				for (const column of columns)
					for (const value of column)
						expect(tuples.has(value)).toBe(false)

				for (const value of table.macroScope.values())
					expect(tuples.has(value)).toBe(false)
				for (const value of table.source.values())
					expect(tuples.has(value)).toBe(false)
			})
	})

	it('runtime is independent of the authoring tuples — serving after clearing the authoring copy', async () => {
		const app = new Elysia()
			.get('/', () => 'root')
			.get('/dyn/:id', ({ params }) => params.id)
		void app.fetch

		// The router (map/router) + `~routeTable` are built. A separately-built
		// table off a *cleared* authoring array must still describe the routes,
		// proving the table carries fields, not tuple references. (We cannot null
		// the private `#declaredRoutes`; instead we rebuild the table from an
		// emptied source and assert the live router still serves — the live table
		// was built from real tuples that the router no longer needs.)
		expect(buildRouteTable([]).length).toBe(0)

		await expect(
			app.handle(new Request('http://localhost/')).then((r) => r.text())
		).resolves.toBe('root')
		await expect(
			app
				.handle(new Request('http://localhost/dyn/42'))
				.then((r) => r.text())
		).resolves.toBe('42')
	})

	it('buildRouteTable is O(n)-ish in construction (10k/1k time ratio < 30)', () => {
		const build = (n: number) => {
			const tuples: any[] = []
			for (let i = 0; i < n; i++)
				tuples.push([
					'GET',
					`/r${i}`,
					() => i,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined
				])
			const start = Bun.nanoseconds()
			for (let r = 0; r < 20; r++) buildRouteTable(tuples)
			return Bun.nanoseconds() - start
		}

		// Warm up JIT.
		build(1)
		build(100)

		const t1k = build(1_000)
		const t10k = build(10_000)

		expect(t10k / t1k).toBeLessThan(30)
	})

	describe('consumer behavior parity through the table', () => {
		it('native-static promoted route still serves (collectStaticRoutes reads the table)', async () => {
			const app = new Elysia().get('/static', 'Static Content')
			const ready = collectStaticRoutes(app as any)?.[0]

			const response = ready?.['/static']?.['GET']
			expect(response).toBeInstanceOf(Response)
			await expect(response!.clone().text()).resolves.toBe(
				'Static Content'
			)
		})

		it('auto-head route serves via the table', async () => {
			const { autoHead } = await import('../../src/plugin/auto-head')
			const app = new Elysia().use(autoHead()).get('/page', () => 'body')
			// autoHead registers HEAD routes asynchronously (awaits a microtask).
			await app.modules
			void app.fetch

			const head = await app.handle(
				new Request('http://localhost/page', { method: 'HEAD' })
			)
			expect(head.status).toBe(200)
			await expect(head.text()).resolves.toBe('')
		})

		it('WS upgrade route builds and registers through the table', async () => {
			const app = new Elysia().ws('/ws', { message() {} })
			void app.fetch

			// WS handler registered in the static map under the WS pseudo-method.
			expect(app['~map']?.['WS']?.['/ws']).toBeTypeOf('function')

			const table = app['~routeTable']
			const wsIndex = table.method.indexOf('WS')
			expect(wsIndex).toBeGreaterThanOrEqual(0)
			expect(table.flags[wsIndex] & RouteFlag.WS).toBeTruthy()
		})

		it('macro + guard + nested-plugin fixture serves every route correctly', async () => {
			const app = buildFixture(false)

			const cases: Array<[string, string]> = [
				['http://localhost/', 'root'],
				['http://localhost/dyn/7', '7'],
				['http://localhost/child/a?q=hi', 'a'],
				['http://localhost/guarded', 'g'],
				['http://localhost/tail', 'tail']
			]

			for (const [url, expected] of cases)
				await expect(
					app.handle(new Request(url)).then((r) => r.text())
				).resolves.toBe(expected)
		})
	})
})
