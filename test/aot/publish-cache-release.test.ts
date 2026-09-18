import { describe, it, expect, afterEach } from 'bun:test'

import { createContext, Elysia, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { Compiled, createAotFingerprint } from '../../src/compile/aot'
import { abortCapture } from '../../src/compile/aot-capture'
import { buildRouteTable, RouteFlag } from '../../src/route-table'

// Passes route registration but fails validator compilation.
const BAD_HEADERS = {
	'~kind': 'Object',
	type: 'object',
	properties: null
} as any

const PROBE_PATH = '/__p5-probe'

/** Register a claimable manifest carrying a probe entry on an unused path. */
const registerProbeManifest = () => {
	Compiled.register({
		bf: 1,
		fingerprint: createAotFingerprint(),
		handlers: {
			GET: { [PROBE_PATH]: { a: [], f: () => () => new Response() } }
		}
	} as any)
}

const registerDuplicateManifest = (path: string) => {
	Compiled.register({
		bf: 1,
		fingerprint: createAotFingerprint(),
		handlers: {
			GET: {
				[PROBE_PATH]: { a: [], f: () => () => new Response() },
				[path]: {
					a: [],
					f: () => () => new Response('manifest winner')
				}
			}
		}
	} as any)
}

const programAlive = (app: any) =>
	Compiled.getHandler(app['~programId'], 'GET', PROBE_PATH) !== undefined

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
	Compiled.clear()
})

describe('publish-time authoring-cache release (004-P5)', () => {
	it('releases the consumed program after an eager production publish and keeps serving', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia()
			for (let i = 0; i < 20; i++) app.get(`/r${i}`, () => 'ok')
			app.compile()

			// eager build consumed the manifest before publish → released
			expect(programAlive(app)).toBe(false)

			expect((await app.handle('/r0')).status).toBe(200)
			expect((await app.handle('/r19')).status).toBe(200)
		})
	})

	it('keeps the program alive across a production JIT publish (first-request compile needs it)', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia().get('/jit', () => 'ok')
			// seal without precompile: fetch getter publishes, JIT compiles later
			void app.fetch

			expect(programAlive(app)).toBe(true)
			expect((await app.handle('/jit')).status).toBe(200)
		})
	})

	it('releases the program in JIT mode once every route has warmed up', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia()
				.get('/a', () => 'a')
				.get('/b', () => 'b')
				.get('/c', () => 'c')
			// JIT publish (no precompile): arms the cold-route countdown
			void app.fetch

			expect(programAlive(app)).toBe(true)

			expect((await app.handle('/a')).status).toBe(200)
			expect(programAlive(app)).toBe(true)
			expect((await app.handle('/b')).status).toBe(200)
			expect(programAlive(app)).toBe(true)

			// last cold route compiles → program fully consumed → released
			expect((await app.handle('/c')).status).toBe(200)
			expect(programAlive(app)).toBe(false)

			// released, but every route keeps serving from compiled handlers
			await expect((await app.handle('/a')).text()).resolves.toBe('a')
			await expect((await app.handle('/c')).text()).resolves.toBe('c')
		})
	})

	it('keeps the JIT program alive until the LAST cold route compiles', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia()
				.get('/a', () => 'a')
				.get('/b', () => 'b')
				.get('/c', () => 'c')
			void app.fetch

			// hit only one route (repeatedly): the countdown must not
			// double-decrement on the thunk's warm early-return
			expect((await app.handle('/a')).status).toBe(200)
			expect((await app.handle('/a')).status).toBe(200)
			expect((await app.handle('/a')).status).toBe(200)

			// two routes still cold → program must stay alive
			expect(programAlive(app)).toBe(true)
		})
	})

	it('releases after exact duplicate winners warm and keeps indexed losers callable', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia()
				.get('/same', () => 'static loser')
				.get('/same', () => 'static winner')
				.get('/dynamic/:id', () => 'dynamic loser')
				.get('/dynamic/:id', () => 'dynamic winner')
				.get('/loose', () => 'loose')
				.get('/loose/', () => 'loose slash')
				.post('/same', () => 'post')
				.get(
					'/bad',
					{ headers: BAD_HEADERS } as any,
					'invalid loser' as any
				)
				.get('/bad', () => 'valid winner')
			void app.fetch

			const Context = createContext(app as any)
			const invoke = async (
				handler: ReturnType<typeof app.handler>,
				path: string
			) =>
				(
					await handler(
						new Context(new Request(`http://localhost${path}`))
					)
				).text()

			// Indexed access is public and must keep compiling the declared loser,
			// but a loser is not a reachable dispatch winner and cannot consume the
			// winner-only release countdown.
			const staticLoser = app.handler(0)
			const dynamicLoser = app.handler(2)
			const invalidLoser = app.handler(7)
			await expect(invoke(dynamicLoser, '/dynamic/1')).resolves.toBe(
				'dynamic loser'
			)

			await expect((await app.handle('/same')).text()).resolves.toBe(
				'static winner'
			)
			await expect((await app.handle('/dynamic/1')).text()).resolves.toBe(
				'dynamic winner'
			)
			await expect((await app.handle('/loose')).text()).resolves.toBe(
				'loose'
			)
			await expect(
				(
					await app.handle(
						new Request('http://localhost/same', { method: 'POST' })
					)
				).text()
			).resolves.toBe('post')
			await expect((await app.handle('/bad')).text()).resolves.toBe(
				'valid winner'
			)

			// A different declared path remains independently cold.
			expect(programAlive(app)).toBe(true)
			await expect((await app.handle('/loose/')).text()).resolves.toBe(
				'loose slash'
			)
			expect(programAlive(app)).toBe(false)

			// Shared JIT staging is gone, but exact loser rows remain available
			// through the retained route table and keep their lazy error timing.
			await expect(invoke(staticLoser, '/same')).resolves.toBe(
				'static loser'
			)
			await expect(invoke(app.handler(2), '/dynamic/1')).resolves.toBe(
				'dynamic loser'
			)
			const invalidResponse = await invalidLoser(
				new Context(new Request('http://localhost/bad'))
			)
			expect(invalidResponse.status).toBe(500)
		})
	})

	it('a static indexed loser bypasses the winner manifest without displacing it', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerDuplicateManifest('/same')

			const app = new Elysia()
				.get('/same', () => 'declared loser')
				.get('/same', () => 'declared winner')
				.get('/other', () => 'other')
			const loser = app.handler(0)
			void app.fetch

			const Context = createContext(app as any)
			const loserResponse = await loser(
				new Context(new Request('http://localhost/same'))
			)
			await expect(loserResponse.text()).resolves.toBe('declared loser')

			// Indexed access hands back the declared loser but publishes
			// nothing: dispatch stays with the last registration, which is
			// still cold and still has to compile for itself.
			expect(programAlive(app)).toBe(true)
			await expect((await app.handle('/same')).text()).resolves.toBe(
				'manifest winner'
			)
			expect(programAlive(app)).toBe(true)
			await expect((await app.handle('/other')).text()).resolves.toBe(
				'other'
			)
			expect(programAlive(app)).toBe(false)
		})
	})

	it('an immediate indexed loser neither takes dispatch nor releases the program', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia()
				.get('/dup', () => 'loser')
				.get('/dup', () => 'winner')
				.get('/other', () => 'other')
			void app.fetch

			await expect((await app.handle('/other')).text()).resolves.toBe(
				'other'
			)
			// the winner is the only route left holding the countdown
			expect(programAlive(app)).toBe(true)

			// compiling the loser eagerly must not spend the winner's slot:
			// releasing here would drop the manifest the winner still needs
			app.handler(0, true)
			expect(programAlive(app)).toBe(true)

			// ...and must not overwrite the winner's key (last-wins)
			await expect((await app.handle('/dup')).text()).resolves.toBe(
				'winner'
			)
			expect(programAlive(app)).toBe(false)
		})
	})

	it('keeps dispatch on the winner across an async-drain publish', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia()
				.get('/same', () => 'loser')
				.get('/same', () => 'winner')
				.get('/other', () => 'other')
				.use(Promise.resolve(new Elysia()))
			await app.modules

			// Async drain built an unsealed router, so the indexed static loser
			// compiles before publish arms its canonical winner — it still may
			// not replace dispatch.
			const Context = createContext(app as any)
			await app.handler(0)(
				new Context(new Request('http://localhost/same'))
			)
			await expect((await app.handle('/same')).text()).resolves.toBe(
				'winner'
			)
			expect(programAlive(app)).toBe(true)

			await expect((await app.handle('/other')).text()).resolves.toBe(
				'other'
			)
			expect(programAlive(app)).toBe(false)
		})
	})

	it('stays pinned when no alias can reach the displaced winner', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia()
				.get('/x y', () => 'loser')
				.get('/x y', () => 'winner')
				.get('/x%20y', () => 'encoded collision')
				.get('/last', () => 'last')
				.use(Promise.resolve(new Elysia()))
			await app.modules

			const Context = createContext(app as any)
			await app.handler(0)(
				new Context(new Request('http://localhost/x%20y'))
			)
			await app.handler(2)(
				new Context(new Request('http://localhost/x%2520y'))
			)

			await expect((await app.handle('/last')).text()).resolves.toBe(
				'last'
			)

			// The winner answers only to the raw `/x y` key — its encoded twin
			// belongs to the explicit collision route — so no request can ever
			// compile it, and an uncompiled winner keeps the countdown open.
			// Compiling its loser by index does not stand in for it.
			expect(programAlive(app)).toBe(true)
		})
	})

	it('leaves the displaced winner cold when only its loser compiles', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			const app = new Elysia()
				.get('/same', () => 'loser')
				.get('/same', () => 'winner')
				.get('/other', () => 'other')
				.use(Promise.resolve(new Elysia()))
			await app.modules

			const Context = createContext(app as any)
			await app.handler(0)(
				new Context(new Request('http://localhost/same'))
			)
			await expect((await app.handle('/other')).text()).resolves.toBe(
				'other'
			)

			// index 0 is the loser (excluded from the countdown outright),
			// index 2 compiled on request — index 1 is the winner nobody has
			// asked for yet and must remain cold
			expect(
				app['~routeTable']!.flags.map(
					(flags) => (flags & RouteFlag.JITCold) !== 0
				)
			).toEqual([false, true, false])
		})
	})

	it('a captured loser compiles before the manifest is claimed by a router', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerDuplicateManifest('/same')

			const app = new Elysia()
				.get('/same', () => 'declared loser')
				.get('/same', () => 'declared winner')

			const Context = createContext(app as any)
			const loser = await app.handler(0)(
				new Context(new Request('http://localhost/same'))
			)
			await expect(loser.text()).resolves.toBe('declared loser')
			expect(programAlive(app)).toBe(false)
		})
	})

	it('marks duplicate losers before an eager router consumes the manifest', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerDuplicateManifest('/same')

			const app = new Elysia()
				.get('/same', () => 'declared loser')
				.get('/same', () => 'declared winner')
			app.compile()

			const Context = createContext(app as any)
			const loser = await app.handler(0)(
				new Context(new Request('http://localhost/same'))
			)
			await expect(loser.text()).resolves.toBe('declared loser')
			await expect((await app.handle('/same')).text()).resolves.toBe(
				'manifest winner'
			)
			expect(programAlive(app)).toBe(false)
		})
	})

	it('marks every earlier exact loser without crossing method boundaries', async () => {
		await withEnv({ NODE_ENV: 'production' }, () => {
			registerProbeManifest()
			const app = new Elysia()
				.get('/same', () => 'first')
				.get('/same', () => 'second')
				.get('/same', () => 'third')
				.post('/same', () => 'post')
			void app.fetch
			const table = app['~routeTable']!

			expect(
				table.flags.map(
					(flags) => (flags & RouteFlag.ExactDuplicate) !== 0
				)
			).toEqual([true, true, false, false])
		})
	})

	it('keeps explicit route and table handler callers compatible', async () => {
		const fromRoute = new Elysia().get('/route', () => 'route')
		const route = fromRoute['~routes'][0]
		const RouteContext = createContext(fromRoute as any)
		const routeResponse = await fromRoute.handler(
			0,
			false,
			route
		)(new RouteContext(new Request('http://localhost/route')))
		await expect(routeResponse.text()).resolves.toBe('route')

		const fromTable = new Elysia().get('/table', () => 'table')
		const table = buildRouteTable(fromTable['~routes'])
		const TableContext = createContext(fromTable as any)
		const tableResponse = await fromTable.handler(
			0,
			false,
			undefined,
			undefined,
			undefined,
			table
		)(new TableContext(new Request('http://localhost/table')))
		await expect(tableResponse.text()).resolves.toBe('table')
	})

	it('does not double-satisfy a displaced winner compiled by index', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia()
				.get('/same', () => 'loser')
				.get('/same', () => 'winner')
				.get('/other', () => 'other')
			const loser = app.handler(0)
			const winner = app.handler(1)
			void app.fetch

			const Context = createContext(app as any)
			await loser(new Context(new Request('http://localhost/same')))
			expect(programAlive(app)).toBe(true)
			await winner(new Context(new Request('http://localhost/same')))
			expect(programAlive(app)).toBe(true)
			await app.handle('/other')
			expect(programAlive(app)).toBe(false)
		})
	})

	it('immediate winners satisfy their route index exactly once', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia().get('/a', () => 'a').get('/b', () => 'b')
			void app.fetch

			app.handler(0, true)
			expect(programAlive(app)).toBe(true)
			app.handler(0, true)
			expect(programAlive(app)).toBe(true)
			app.handler(1, true)
			expect(programAlive(app)).toBe(false)
		})
	})

	it('an immediate duplicate publishes no key, whichever aliases it owns', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			// a single-key duplicate and an alias-expanding one behave alike:
			// neither publishes, so the winner stays the only cold route
			const strict = new Elysia({ strictPath: true })
				.get('/same', () => 'strict loser')
				.get('/same', () => 'strict winner')
			void strict.fetch
			strict.handler(0, true)
			expect(programAlive(strict)).toBe(true)
			await expect((await strict.handle('/same')).text()).resolves.toBe(
				'strict winner'
			)
			expect(programAlive(strict)).toBe(false)

			Compiled.clear()
			registerProbeManifest()
			const aliased = new Elysia()
				.get('/x y/', () => 'alias loser')
				.get('/x y/', () => 'alias winner')
			void aliased.fetch
			aliased.handler(0, true)
			expect(programAlive(aliased)).toBe(true)
			await expect(
				(await aliased.handle('/x%20y/')).text()
			).resolves.toBe('alias winner')
			expect(programAlive(aliased)).toBe(false)
		})
	})

	it('keeps every shadowed alias on the winner, released program or not', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			const observeLoser = async (releaseFirst: boolean) => {
				registerProbeManifest()

				const app = new Elysia()
					.get('/x y/', () => 'loser')
					.get('/x y/', () => 'winner')
				const loser = app.handler(0)
				if (releaseFirst) app.handler(1, true)
				void app.fetch

				expect(programAlive(app)).toBe(!releaseFirst)

				const Context = createContext(app as any)
				await expect(
					(
						await loser(
							new Context(new Request('http://localhost/x%20y/'))
						)
					).text()
				).resolves.toBe('loser')
				// compiling the loser publishes nothing and credits nobody,
				// so it cannot move the countdown either way
				expect(programAlive(app)).toBe(!releaseFirst)

				const result = [
					await (await app.handle('/x%20y')).text(),
					await (await app.handle('/x%20y/')).text()
				]

				Compiled.clear()
				return result
			}

			const beforeRelease = await observeLoser(false)
			const afterRelease = await observeLoser(true)

			expect(beforeRelease).toEqual(['winner', 'winner'])
			expect(afterRelease).toEqual(beforeRelease)
		})
	})

	it('compiles a loser from the retained route table after the release', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia()
				.get('/x y/', () => 'loser')
				.get('/x y/', () => 'winner')
			const loser = app.handler(0)
			void app.fetch

			// the winner is the only cold row: serving it consumes the program
			await expect((await app.handle('/x%20y/')).text()).resolves.toBe(
				'winner'
			)
			expect(programAlive(app)).toBe(false)

			// the loser compiles afterwards from `~routeTable` (the shared JIT
			// staging is gone) and still must not take an alias back
			const Context = createContext(app as any)
			await expect(
				(
					await loser(
						new Context(new Request('http://localhost/x%20y/'))
					)
				).text()
			).resolves.toBe('loser')
			await expect((await app.handle('/x%20y')).text()).resolves.toBe(
				'winner'
			)
			await expect((await app.handle('/x%20y/')).text()).resolves.toBe(
				'winner'
			)
		})
	})

	it('disarms on a sealed-generation rebuild and re-arms for the new generation', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia().get('/a', () => 'a').get('/b', () => 'b')
			void app.fetch
			await app.handle('/a') // partial warmup: one route still cold
			expect(programAlive(app)).toBe(true)

			// force a sealed-generation rebuild (mirror generation.test.ts):
			// registerRoute disarms, ~newGeneration re-claims + re-arms
			;(app as any)['~generation'] = undefined
			registerProbeManifest()
			app.get('/c', () => 'c')
			app['~newGeneration']()

			expect(programAlive(app)).toBe(true)

			// warm every route in the new generation → release again
			await expect((await app.handle('/a')).text()).resolves.toBe('a')
			await expect((await app.handle('/b')).text()).resolves.toBe('b')
			await expect((await app.handle('/c')).text()).resolves.toBe('c')
			expect(programAlive(app)).toBe(false)
		})
	})

	it('never releases in JIT mode outside production even after full warmup', async () => {
		await withEnv({ NODE_ENV: 'test' }, async () => {
			registerProbeManifest()

			const app = new Elysia().get('/a', () => 'a').get('/b', () => 'b')
			void app.fetch

			expect((await app.handle('/a')).status).toBe(200)
			expect((await app.handle('/b')).status).toBe(200)

			// dev keeps the program: no countdown is armed outside production
			expect(programAlive(app)).toBe(true)
		})
	})

	it('keeps bridge-uninitialized duplicate validation on the ordinary fallback path', () => {
		const proc = Bun.spawnSync({
			cmd: [
				process.execPath,
				`${import.meta.dir}/fixtures/duplicate-dev-bridge-free-child.ts`
			],
			cwd: `${import.meta.dir}/../..`,
			env: { ...process.env, NODE_ENV: 'test', ELYSIA_AOT_BUILD: '' },
			stdout: 'pipe',
			stderr: 'pipe'
		})

		expect(proc.exitCode, proc.stderr.toString()).toBe(0)
		const result = JSON.parse(proc.stdout.toString())
		expect(result.live).toBe(false)
		expect(result.duplicate).toBe(result.ordinary)
		expect(result.duplicate).toBe(500)
		expect(result.duplicateLookups).toBeGreaterThan(0)
		expect(result.duplicateLookups).toBe(result.ordinaryLookups)
	})

	it('explains why a duplicate loser cannot recover from a cold bridge', () => {
		// With a claimed program the loser compiles `liveOnly`: it may NOT
		// borrow the frozen validator (that slot is keyed by method+path, so it
		// holds the winner's schema), so a cold bridge is unrecoverable there.
		// It must say so instead of leaking the generic bridge error.
		const proc = Bun.spawnSync({
			cmd: [
				process.execPath,
				`${import.meta.dir}/fixtures/duplicate-liveonly-bridge-free-child.ts`
			],
			cwd: `${import.meta.dir}/../..`,
			env: { ...process.env, NODE_ENV: 'test', ELYSIA_AOT_BUILD: '' },
			stdout: 'pipe',
			stderr: 'pipe'
		})

		expect(proc.exitCode, proc.stderr.toString()).toBe(0)
		const result = JSON.parse(proc.stdout.toString())

		expect(result.live).toBe(false)
		expect(result.programAlive).toBe(true)

		expect(result.loser.message).toContain('Duplicate route')
		expect(result.loser.message).toContain(
			'TypeBox bridge is not initialized'
		)
		// the underlying bridge error is preserved, not swallowed
		expect(result.loser.cause).toContain("Typebox module isn't initialized")

		// the non-duplicate route keeps the existing (recoverable) behaviour
		expect(result.winner.message).toContain(
			"Typebox module isn't initialized"
		)
		expect(result.winner.message).not.toContain('duplicate route')
	})

	it('keeps the program alive outside production (dev hot-reload rebuilds need caches)', async () => {
		await withEnv({ NODE_ENV: 'test' }, async () => {
			registerProbeManifest()

			const app = new Elysia().get('/dev', () => 'ok')
			app.compile()

			expect(programAlive(app)).toBe(true)
			expect((await app.handle('/dev')).status).toBe(200)
		})
	})

	it('keeps the program alive under AOT build capture even in production', async () => {
		await withEnv(
			{ NODE_ENV: 'production', ELYSIA_AOT_BUILD: '1' },
			async () => {
				try {
					registerProbeManifest()

					const app = new Elysia().get('/aot', () => 'ok')
					app.compile()

					expect(programAlive(app)).toBe(true)
				} finally {
					abortCapture()
				}
			}
		)
	})

	it('an indexed WS row cannot consume either of two HTTP countdown slots', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia()
				.use(websocket())
				.ws('/ws', { message: () => {} })
				.get('/a', () => 'a')
				.get('/b', () => 'b')
			const indexedWS = app.handler(0)
			// JIT publish (no precompile): arms the cold-route countdown.
			// The WS row is consumed eagerly at build time and must be
			// excluded from the count, or `cold` never reaches 0.
			void app.fetch

			expect(programAlive(app)).toBe(true)
			const Context = createContext(app as any)
			await indexedWS(new Context(new Request('http://localhost/ws')))
			expect(programAlive(app)).toBe(true)

			// Only the two HTTP rows are eligible, irrespective of indexed WS access.
			expect((await app.handle('/a')).status).toBe(200)
			expect(programAlive(app)).toBe(true)
			expect((await app.handle('/b')).status).toBe(200)
			expect(programAlive(app)).toBe(false)
		})
	})

	it('a loose alias satisfies its route index only once', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia()
				.get('/alias/', () => 'alias')
				.get('/other', () => 'other')
			void app.fetch

			await expect((await app.handle('/alias')).text()).resolves.toBe(
				'alias'
			)
			expect(programAlive(app)).toBe(true)
			await expect((await app.handle('/alias/')).text()).resolves.toBe(
				'alias'
			)
			expect(programAlive(app)).toBe(true)
			await expect((await app.handle('/other')).text()).resolves.toBe(
				'other'
			)
			expect(programAlive(app)).toBe(false)
		})
	})

	it('WS routes do not pin the AOT program after warmup (all-WS app releases at publish)', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia()
				.use(websocket())
				.ws('/a', { message: () => {} })
				.use(websocket())
				.ws('/b', { message: () => {} })
			// no HTTP route ever cold-compiles, so every row must be
			// excluded from the count at arming time -> released at publish
			void app.fetch

			expect(programAlive(app)).toBe(false)
		})
	})

	it('recompiles correctly after the release (caches are recomputable, just cold)', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			const app = new Elysia()
				.get('/plain', () => 'ok')
				.post(
					'/typed',
					{ body: t.Object({ n: t.Number() }) },
					({ body }) => body
				)
			app.compile()

			expect((await app.handle('/plain')).status).toBe(200)

			// second eager compile after the release must rebuild from scratch
			app.compile()

			expect((await app.handle('/plain')).status).toBe(200)
			const typed = await app.handle(
				new Request('http://localhost/typed', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ n: 1 })
				})
			)
			expect(typed.status).toBe(200)
			await expect(typed.json()).resolves.toEqual({ n: 1 })
		})
	})

	it('builds a second app correctly after the first app released its caches', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			const first = new Elysia().get('/a', () => 'a')
			first.compile()
			expect((await first.handle('/a')).status).toBe(200)

			// app B builds after A's release: recomputes shared analysis
			const second = new Elysia()
				.get('/b', () => 'b')
				.get('/guarded', ({ query: { name } }) => name ?? 'none')
			second.compile()

			expect((await second.handle('/b')).status).toBe(200)
			await expect(
				(await second.handle('/guarded?name=x')).text()
			).resolves.toBe('x')
			// and A keeps serving
			expect((await first.handle('/a')).status).toBe(200)
		})
	})
})
