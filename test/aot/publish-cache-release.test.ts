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
