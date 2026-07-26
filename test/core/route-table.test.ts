// @ts-nocheck
import { Elysia, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { buildRouteTable, routeRow, RouteFlag } from '../../src/route-table'
import { collectStaticRoutes } from '../../src/adapter/bun'
import { describe, expect, it } from 'bun:test'

const buildFixture = () => {
	const child = new Elysia({ prefix: '/child' })
		.get('/a', { query: t.Object({ q: t.String() }) }, () => 'a')
		.use(websocket()).ws('/socket', { message() {} })

	const guarded = new Elysia()
		.guard({ beforeHandle() {} })
		.get('/guarded', () => 'g')

	const app = new Elysia()
		.macro({ auth: { resolve: () => ({ user: 'x' }) } })
		.get('/', () => 'root')
		.get('/dyn/:id', ({ params }) => params.id)
		.use(child)
		.use(guarded)
		.get('/tail', { auth: true }, () => 'tail')

	void app.fetch

	return app
}

const rawTuples = (app: any): readonly any[] => app['~routes']

describe('columnar route table', () => {
	it('stores every authoring tuple field', () => {
		const app = buildFixture()
		const table = app['~routeTable']
		const tuples = rawTuples(app)

		expect(table).toBeDefined()
		expect(table.length).toBe(tuples.length)

		for (let i = 0; i < tuples.length; i++) {
			const t = tuples[i]

			expect(table.method[i]).toBe(t[0])
			expect(table.path[i]).toBe(t[1])
			expect(table.handler[i]).toBe(t[2])
			expect(table.owner[i]).toBe(t[3])
			expect(table.localHook[i]).toBe(t[4])
			expect(table.appHook[i]).toBe(t[5])
			expect(table.inheritedChain[i]).toBe(t[6])

			if (t[7] === undefined)
				expect(table.macroScope?.has(i) ?? false).toBe(false)
			else expect(table.macroScope.get(i)).toBe(t[7])

			expect(!!(table.flags[i] & RouteFlag.WS)).toBe(t[0] === 'WS')
			expect(!!(table.flags[i] & RouteFlag.Dynamic)).toBe(
				/[:*]/.test(t[1])
			)
		}
	})

	it('routeRow returns a fresh tuple with every stored field', () => {
		const app = buildFixture()
		const table = app['~routeTable']
		const tuples = rawTuples(app)

		for (let i = 0; i < tuples.length; i++) {
			const row = routeRow(table, i)
			const t = tuples[i]

			for (let f = 0; f < 8; f++) expect(row[f]).toBe(t[f])

			expect(row).not.toBe(t)
		}
	})

	it('does not retain authoring tuple arrays', () => {
		const app = buildFixture()
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

		for (const value of table.macroScope?.values() ?? [])
			expect(tuples.has(value)).toBe(false)
	})

	it('builds an empty table from an empty declaration list', () => {
		expect(buildRouteTable([]).length).toBe(0)
	})

	it('serves static and dynamic routes after route table construction', async () => {
		const app = new Elysia()
			.get('/', () => 'root')
			.get('/dyn/:id', ({ params }) => params.id)
		void app.fetch

		await expect(
			app.handle(new Request('http://localhost/')).then((r) => r.text())
		).resolves.toBe('root')
		await expect(
			app
				.handle(new Request('http://localhost/dyn/42'))
				.then((r) => r.text())
		).resolves.toBe('42')
	})

	it('construction stays below 30x when the route count grows 10x', () => {
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

		build(1)
		build(100)

		const t1k = build(1_000)
		const t10k = build(10_000)

		expect(t10k / t1k).toBeLessThan(30)
	})

	describe('route table consumers', () => {
		it('serves a route promoted to a native static response', async () => {
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
			await app.modules
			void app.fetch

			const head = await app.handle(
				new Request('http://localhost/page', { method: 'HEAD' })
			)
			expect(head.status).toBe(200)
			await expect(head.text()).resolves.toBe('')
		})

		it('registers a WebSocket upgrade route', async () => {
			const app = new Elysia().use(websocket()).ws('/ws', { message() {} })
			void app.fetch

			expect(app['~map']?.['WS']?.['/ws']).toBeTypeOf('function')

			const table = app['~routeTable']
			const wsIndex = table.method.indexOf('WS')
			expect(wsIndex).toBeGreaterThanOrEqual(0)
			expect(table.flags[wsIndex] & RouteFlag.WS).toBeTruthy()
		})

		it('serves macro, guard, dynamic, and nested plugin routes', async () => {
			const app = buildFixture()

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
