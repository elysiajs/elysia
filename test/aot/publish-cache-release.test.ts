import { describe, it, expect, afterEach } from 'bun:test'

import { Elysia, t } from '../../src'
import { Compiled, createAotFingerprint } from '../../src/compile/aot'
import {
	abortCapture,
	installCaptureImpl
} from '../../src/compile/aot-capture'
import { req } from '../utils'

/**
 * salvage 004-P5 — publish-time authoring-cache release.
 *
 * WHY these tests exist: releasing caches at `#publishGeneration` must only
 * ever trade speed (an uncached recompile), never correctness. The one
 * non-recomputable store is the frozen `Compiled` program registration —
 * JIT compiles read it at FIRST REQUEST, i.e. after publish, so releasing
 * it in JIT mode would silently break sealed apps. These tests pin the
 * exact gate matrix: release fires only under production + eager build +
 * not AOT-build capture, and behavior is identical either way.
 */

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

			expect((await app.handle(req('/r0'))).status).toBe(200)
			expect((await app.handle(req('/r19'))).status).toBe(200)
		})
	})

	it('keeps the program alive across a production JIT publish (first-request compile needs it)', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia().get('/jit', () => 'ok')
			// seal without precompile: fetch getter publishes, JIT compiles later
			void app.fetch

			expect(programAlive(app)).toBe(true)
			expect((await app.handle(req('/jit'))).status).toBe(200)
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

			expect((await app.handle(req('/a'))).status).toBe(200)
			expect(programAlive(app)).toBe(true)
			expect((await app.handle(req('/b'))).status).toBe(200)
			expect(programAlive(app)).toBe(true)

			// last cold route compiles → program fully consumed → released
			expect((await app.handle(req('/c'))).status).toBe(200)
			expect(programAlive(app)).toBe(false)

			// released, but every route keeps serving from compiled handlers
			expect(await (await app.handle(req('/a'))).text()).toBe('a')
			expect(await (await app.handle(req('/c'))).text()).toBe('c')
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
			expect((await app.handle(req('/a'))).status).toBe(200)
			expect((await app.handle(req('/a'))).status).toBe(200)
			expect((await app.handle(req('/a'))).status).toBe(200)

			// two routes still cold → program must stay alive
			expect(programAlive(app)).toBe(true)
		})
	})

	it('disarms on a sealed-generation rebuild and re-arms for the new generation', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia().get('/a', () => 'a').get('/b', () => 'b')
			void app.fetch
			await app.handle(req('/a')) // partial warmup: one route still cold
			expect(programAlive(app)).toBe(true)

			// force a sealed-generation rebuild (mirror generation.test.ts):
			// registerRoute disarms, ~newGeneration re-claims + re-arms
			;(app as any)['~generation'] = undefined
			registerProbeManifest()
			app.get('/c', () => 'c')
			app['~newGeneration']()

			expect(programAlive(app)).toBe(true)

			// warm every route in the new generation → release again
			expect(await (await app.handle(req('/a'))).text()).toBe('a')
			expect(await (await app.handle(req('/b'))).text()).toBe('b')
			expect(await (await app.handle(req('/c'))).text()).toBe('c')
			expect(programAlive(app)).toBe(false)
		})
	})

	it('never releases in JIT mode outside production even after full warmup', async () => {
		await withEnv({ NODE_ENV: 'test' }, async () => {
			registerProbeManifest()

			const app = new Elysia().get('/a', () => 'a').get('/b', () => 'b')
			void app.fetch

			expect((await app.handle(req('/a'))).status).toBe(200)
			expect((await app.handle(req('/b'))).status).toBe(200)

			// dev keeps the program: no countdown is armed outside production
			expect(programAlive(app)).toBe(true)
		})
	})

	it('keeps the program alive outside production (dev hot-reload rebuilds need caches)', async () => {
		await withEnv({ NODE_ENV: 'test' }, async () => {
			registerProbeManifest()

			const app = new Elysia().get('/dev', () => 'ok')
			app.compile()

			expect(programAlive(app)).toBe(true)
			expect((await app.handle(req('/dev'))).status).toBe(200)
		})
	})

	it('keeps the program alive under AOT build capture even in production', async () => {
		await withEnv(
			{ NODE_ENV: 'production', ELYSIA_AOT_BUILD: '1' },
			async () => {
				installCaptureImpl()
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

	it('WS routes do not pin the AOT program after warmup (mixed WS + HTTP)', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia()
				.ws('/ws', { message: () => {} })
				.get('/a', () => 'a')
			// JIT publish (no precompile): arms the cold-route countdown.
			// The WS row is consumed eagerly at build time and must be
			// excluded from the count, or `cold` never reaches 0.
			void app.fetch

			expect(programAlive(app)).toBe(true)

			// only the HTTP route ever reaches #jitDispatch
			expect((await app.handle(req('/a'))).status).toBe(200)
			expect(programAlive(app)).toBe(false)
		})
	})

	it('WS routes do not pin the AOT program after warmup (all-WS app releases at publish)', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			registerProbeManifest()

			const app = new Elysia()
				.ws('/a', { message: () => {} })
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
				.post('/typed', { body: t.Object({ n: t.Number() }) }, ({ body }) => body)
			app.compile()

			expect((await app.handle(req('/plain'))).status).toBe(200)

			// second eager compile after the release must rebuild from scratch
			app.compile()

			expect((await app.handle(req('/plain'))).status).toBe(200)
			const typed = await app.handle(
				new Request('http://localhost/typed', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ n: 1 })
				})
			)
			expect(typed.status).toBe(200)
			expect(await typed.json()).toEqual({ n: 1 })
		})
	})

	it('builds a second app correctly after the first app released its caches', async () => {
		await withEnv({ NODE_ENV: 'production' }, async () => {
			const first = new Elysia().get('/a', () => 'a')
			first.compile()
			expect((await first.handle(req('/a'))).status).toBe(200)

			// app B builds after A's release: recomputes shared analysis
			const second = new Elysia()
				.get('/b', () => 'b')
				.get('/guarded', ({ query: { name } }) => name ?? 'none')
			second.compile()

			expect((await second.handle(req('/b'))).status).toBe(200)
			expect(
				await (await second.handle(req('/guarded?name=x'))).text()
			).toBe('x')
			// and A keeps serving
			expect((await first.handle(req('/a'))).status).toBe(200)
		})
	})
})
