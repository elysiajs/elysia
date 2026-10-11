import { describe, it, expect, afterEach } from 'bun:test'

import { Elysia } from '../../src'

/**
 * Plan 007 — after a seal (any env), a fast-path (non-macro) app releases its
 * `declaredRoutes` tuple array because the same metadata is held columnar in
 * `~routeTable`. Every consumer rematerializes the array on demand from the
 * table. WHY these tests exist: the release is a pure memory optimization and
 * MUST be invisible — introspection getters (`routes`/`history`), the re-seal
 * mutation path (clear `~generation`, register, re-seal), and merging a sealed
 * app as a child must all behave exactly as if the array had never been
 * released. A missing guard
 * or a broken rematerializer surfaces here as lost routes or empty getters,
 * not as a silent memory win.
 *
 * Env-toggling mirrors test/aot/publish-cache-release.test.ts (known `env -u
 * NODE_ENV` footgun — reuse, don't invent).
 */

const withEnv = async (
	values: Record<string, string | undefined>,
	run: () => Promise<void> | void
) => {
	const previous: Record<string, string | undefined> = {}
	for (const key in values) {
		previous[key] = process.env[key]
		if (values[key] === undefined) delete process.env[key]
		else process.env[key] = values[key]
	}
	try {
		await run()
	} finally {
		for (const key in previous) {
			if (previous[key] === undefined) delete process.env[key]
			else process.env[key] = previous[key]
		}
	}
}

afterEach(() => {
	delete process.env.NODE_ENV
})

describe('plan 007 — declaredRoutes release + rematerialize', () => {
	it('fast-path prod seal: routes/history rematerialize (sources survive)', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			const child = new Elysia({ name: 'child' })
				.get('/first', () => 'first')
				.get('/second', () => 'second')
			const app = new Elysia().use(child).get('/root', () => 'root')

			// Seal + publish (JIT). Under production this releases the
			// fast-path app's declaredRoutes.
			void app.fetch

			// Introspection must rebuild the array transparently, including the
			// separately-retained routeSources labels.
			expect(app.routes.map((r) => r.path)).toEqual([
				'/first',
				'/second',
				'/root'
			])
			expect(app.history).toEqual([
				{ sequence: 0, method: 'GET', path: '/first', source: 'child' },
				{
					sequence: 1,
					method: 'GET',
					path: '/second',
					source: 'child'
				},
				{ sequence: 2, method: 'GET', path: '/root' }
			])

			// Dispatch still works for every route after the release.
			await expect((await app.handle('/first')).text()).resolves.toBe(
				'first'
			)
			await expect((await app.handle('/root')).text()).resolves.toBe(
				'root'
			)

			// Repeated introspection stays stable (rematerialized once, cached).
			expect(app.routes.map((r) => r.path)).toEqual([
				'/first',
				'/second',
				'/root'
			])
		})
	})

	it('re-seal dance after release adds routes without losing the old ones', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			const app = new Elysia().get('/a', () => 'a').get('/b', () => 'b')

			// Seal → release declaredRoutes.
			void app.fetch
			expect((await app.handle('/a')).status).toBe(200)

			// Mirror generation.test.ts: clear the generation, register a new
			// route (registerRoute must rematerialize the released array before
			// appending — the append-vs-rebuild hazard), then re-seal.
			;(app as any)['~generation'] = undefined
			app.get('/c', () => 'c')
			void app.fetch
			expect(app['~generation']).toBeDefined()

			// Old AND new routes must respond; none dropped on rebuild.
			await expect((await app.handle('/a')).text()).resolves.toBe('a')
			await expect((await app.handle('/b')).text()).resolves.toBe('b')
			await expect((await app.handle('/c')).text()).resolves.toBe('c')
			expect(app.routes.map((r) => r.path)).toEqual(['/a', '/b', '/c'])
		})
	})

	it('merging a SEALED fast-path child keeps all of the child routes', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			const child = new Elysia()
				.get('/c1', () => 'c1')
				.get('/c2', () => 'c2')

			// Seal the child independently → its declaredRoutes is released.
			void child.fetch
			expect((await child.handle('/c1')).status).toBe(200)

			// A fresh parent merges the released child: the merge site must
			// rematerialize the child before reading its routes.
			const parent = new Elysia().use(child).get('/p', () => 'p')

			expect(parent.routes.map((r) => r.path)).toEqual([
				'/c1',
				'/c2',
				'/p'
			])
			await expect((await parent.handle('/c1')).text()).resolves.toBe(
				'c1'
			)
			await expect((await parent.handle('/c2')).text()).resolves.toBe(
				'c2'
			)
			await expect((await parent.handle('/p')).text()).resolves.toBe('p')
		})
	})

	it('macro app is NOT released: routes still resolve macro hooks after seal', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			let ran = 0
			const app = new Elysia()
				.macro({
					hi(fn: () => any) {
						return { beforeHandle: fn }
					}
				})
				.get('/m', { hi: () => void ran++ } as any, () => 'm')

			// Not on the getter fast path → release must NOT fire; the table
			// column holds macro-RESOLVED hooks, so keeping the raw array is
			// required for correct macro resolution.
			expect((app as any)['~ext']?.macro).toBeDefined()

			void app.fetch
			expect((app as any).declaredRoutes).toBeDefined()

			// The macro hook still runs and introspection resolves it.
			expect((await app.handle('/m')).status).toBe(200)
			expect(ran).toBeGreaterThan(0)
			expect(app.routes.map((r) => r.path)).toEqual(['/m'])
			expect(
				(app as any)['~routes'][0][4]?.beforeHandle?.length ?? 0
			).toBeGreaterThan(0)
		})
	})

	// A dev server holds as many routes as production; the rows are the one
	// copy of route metadata the table already covers
	it('dev mode releases on seal: introspection identical, rows rematerialize on demand', async () => {
		// No NODE_ENV=production
		const app = new Elysia().get('/x', () => 'x').get('/y', () => 'y')

		const before = app.routes.map((r) => r.path)
		const beforeHistory = app.history.map((h) => h.path)

		void app.fetch

		// released at publish, before any getter can rematerialize it
		expect((app as any).declaredRoutes).toBeUndefined()

		expect(app.routes.map((r) => r.path)).toEqual(before)
		expect(app.history.map((h) => h.path)).toEqual(beforeHistory)
		// introspection rebuilt the rows from the route table
		expect((app as any).declaredRoutes).toHaveLength(2)
		expect((await app.handle('/x')).status).toBe(200)
	})

	// `.listen()` collects Bun's native routes right after the seal. Reading
	// `~routes` there would rematerialize the rows it just released, so a Bun
	// server would never keep the saving
	it.each(['production', 'development'])(
		'.listen() keeps the rows released after serving a request (%s)',
		async (NODE_ENV) => {
			await withEnv({ NODE_ENV }, async () => {
				const app = new Elysia()
					.get('/a', () => 'a')
					.get('/b', () => 'b')
				app.listen(0)

				try {
					const res = await fetch(
						`http://localhost:${app.server!.port}/a`
					)
					await expect(res.text()).resolves.toBe('a')

					expect((app as any).declaredRoutes).toBeUndefined()
				} finally {
					await app.stop()
				}
			})
		}
	)
})
