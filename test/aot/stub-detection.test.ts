import { describe, it, expect, afterEach } from 'bun:test'
import { resolve } from 'node:path'
import { rm } from 'node:fs/promises'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	analyzeStubbability,
	captureArtifacts,
	replayStubbability
} from '../../src/plugin/source'
import { generateCompiledArtifacts, STUB_SOURCES } from '../../src/plugin/core'
import { aot as bunAot } from '../../src/plugin/bun'
import { materialise, materialiseHandlers } from './_manifest'
import { post, req } from '../utils'

const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/index.ts')
const STRIP_E2E_APP = resolve(import.meta.dir, 'fixtures/strip-e2e-app.ts')

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

/**
 * The strip detector decides whether a frozen build can run with handler JIT
 * (`sucrose`) replaced by a throwing stub. The decision MUST be sound:
 * a false "stubbable" ships a build that crashes at runtime, so every "true"
 * here is also exercised against a live frozen replay.
 */
describe('AOT strip detection (analyzeStubbability)', () => {
	it('handler-stubbable: body schema + non-inline handler', async () => {
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ name: t.String() }) },
			({ body }) => body
		)
		const r = await analyzeStubbability(app as any)
		expect(r.stubbable).toBe(true)
		expect(r.jit).toBe(true)
		expect(r.reasons).toEqual([])
	})

	it('handler-stubbable: inline-eligible handler is captured too', async () => {
		// Inline handlers still avoid runtime eval, but capture stores the full
		// generated factory so a frozen build can reconstruct without sucrose.
		const app = new Elysia().get('/', () => 'ok')
		const r = await analyzeStubbability(app as any)
		expect(r.stubbable).toBe(true)
		expect(r.jit).toBe(true)
		expect(r.reasons).toEqual([])
	})

	it('mixed app: schema route + inline route is handler-stubbable', async () => {
		const app = new Elysia()
			.post(
				'/p',
				{ body: t.Object({ name: t.String() }) },
				({ body }) => body
			)
			.get('/g', () => 'ok')
		const r = await analyzeStubbability(app as any)
		expect(r.jit).toBe(true)
		expect(r.stubbable).toBe(true)
	})

	it('WS route is never handler-stubbable', async () => {
		const app = new Elysia().ws('/ws', { message: () => {} })
		const r = await analyzeStubbability(app as any)
		expect(r.jit).toBe(false)
		expect(r.stubbable).toBe(false)
	})

	// `mount()` is intentionally NOT special-cased: the forwarding handler is
	// captured and inline-eligible, so the replay sees a fully precompiled app.
	// A mounted sub-app compiles lazily and is invisible to AOT capture, so
	// stripping + mount + AOT is a documented user caveat (use strip:false or
	// AOT-build the mounted app), not something the detector guards against.
	it('mounted app is reported stubbable (mount + AOT strip is a documented caveat)', async () => {
		const inner = new Elysia().get('/hello', () => 'from-inner')
		const app = new Elysia().mount('/sub', inner.handle)

		const r = await analyzeStubbability(app as any)
		expect(r.jit).toBe(true)
		expect(r.stubbable).toBe(true)
	})

	it('detection is side-effect free (registry restored afterwards)', async () => {
		const before = Compiled.validators
		await analyzeStubbability(
			new Elysia().post(
				'/',
				{ body: t.Object({ a: t.Number() }) },
				({ body }) => body
			) as any
		)
		expect(Compiled.validators).toBe(before)
	})

	it('detection clears temporary handlers when only validators existed before replay', async () => {
		Compiled.validators = {}
		expect(Compiled.handlers).toBeUndefined()

		await analyzeStubbability(
			new Elysia().post(
				'/',
				{ body: t.Object({ a: t.Number() }) },
				({ body }) => body
			) as any
		)

		expect(Compiled.validators).toEqual({})
		expect(Compiled.handlers).toBeUndefined()
	})

	it('replay is side-effect free for unmaterialized lazy validator groups', () => {
		let built = 0
		Compiled.registerLazyValidators(
			[
				() => {
					built++
					return {
						GET: {
							'/lazy': {
								body: { d: 1 }
							}
						}
					} as any
				}
			],
			{
				GET: {
					'/lazy': 0
				}
			}
		)

		expect(Compiled.hasValidator('GET', '/lazy', 'body')).toBe(true)
		expect(built).toBe(0)

		const report = replayStubbability(new Elysia() as any, [])
		expect(report.stubbable).toBe(true)

		// Before this regression fix, replayStubbability restored only the visible
		// validators object after Compiled.clear(), losing lazyGroups/lazyGroupOf.
		// The route still looked unmaterialized, but no longer resolved.
		expect(Compiled.hasValidator('GET', '/lazy', 'body')).toBe(true)
		expect(built).toBe(0)
		expect(Compiled.getValidator('GET', '/lazy', 'body')?.d).toBe(1)
		expect(built).toBe(1)
	})

	it("plugin default strip:'auto' stubs only when every route has a frozen handler", async () => {
		const safe = await generateCompiledArtifacts(
			'test/aot/fixtures/strip-schema.ts'
		)
		expect(safe.stub).toEqual({
			jit: true,
			ws: true,
			// schema route uses the `va` alias → reconstruct module must be kept
			reconstruct: false,
			// no cookie alias (`cc`) → request-side cookie machinery is stubbable
			cookie: true
		})

		const inline = await generateCompiledArtifacts(
			'test/aot/fixtures/strip-inline.ts'
		)
		expect(inline.stub).toEqual({
			jit: true,
			ws: true,
			// no validator/cookie/trace alias anywhere → safe to stub reconstruct
			reconstruct: true,
			cookie: true
		})

		const unsafe = await generateCompiledArtifacts(
			'test/aot/fixtures/strip-ws.ts'
		)
		expect(unsafe.stub).toEqual({
			jit: false,
			ws: false,
			reconstruct: false,
			cookie: false
		})
	})

	it('strip:true throws when handler JIT is still reachable', async () => {
		await expect(
			generateCompiledArtifacts('test/aot/fixtures/strip-ws.ts', {
				strip: true
			})
		).rejects.toThrow('AOT handler manifest')
	})

	it('SOUNDNESS: a "jit:true" frozen app handles requests from the manifest', async () => {
		// Prove the green light is real. The detector replays the frozen handler
		// manifest under a tripwire that increments on handler-JIT entry points.
		// Then a real frozen app handles requests from that same manifest.
		const build = () =>
			new Elysia().post(
				'/u',
				{ body: t.Object({ name: t.String(), age: t.Number() }) },
				({ body }) => body
			)

		const { validators, handlers } = await captureArtifacts(
			build() as any,
			{
				register: false
			}
		)
		const report = replayStubbability(build() as any, handlers)
		expect(report.jit).toBe(true)

		// Register the frozen manifest and run real requests against a frozen
		// app.
		Compiled.clear()
		Validator.clear()
		Compiled.validators = materialise(validators)
		Compiled.handlers = materialiseHandlers(handlers)

		const frozen = build()
		frozen.compile()

		const ok = await frozen
			.handle(
				req('/u', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ name: 'a', age: 1 })
				})
			)
			.then((r) => r.json())
		expect(ok).toEqual({ name: 'a', age: 1 })

		const bad = await frozen.handle(
			req('/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a' })
			})
		)
		expect(bad.status).toBe(422)
	})

	it('STUB_SOURCES filters match both src and dist module paths', () => {
		// Public/source sucrose imports are userland API, not the internal
		// handler compiler. Strip must never replace them.
		expect(
			STUB_SOURCES.jit.some(({ filter }) =>
				filter.test('/x/dist/sucrose.js')
			)
		).toBe(false)
		expect(
			STUB_SOURCES.jit.some(({ filter }) =>
				filter.test('/x/src/sucrose.ts')
			)
		).toBe(false)
		expect(
			STUB_SOURCES.jit.some(({ filter }) =>
				filter.test('/x/dist/compile/handler/jit.mjs')
			)
		).toBe(true)
		expect(
			STUB_SOURCES.jit.some(({ filter }) =>
				filter.test('/x/src/compile/handler/jit.ts')
			)
		).toBe(true)
		expect(
			STUB_SOURCES.ws.some(({ filter }) =>
				filter.test('/x/dist/ws/route.mjs')
			)
		).toBe(true)
		expect(
			STUB_SOURCES.ws.some(({ filter }) =>
				filter.test('/x/src/ws/route.ts')
			)
		).toBe(true)
		expect(
			STUB_SOURCES.reconstruct.some(({ filter }) =>
				filter.test('/x/src/compile/handler/reconstruct.ts')
			)
		).toBe(true)
		expect(
			STUB_SOURCES.reconstruct.some(({ filter }) =>
				filter.test('/x/dist/compile/handler/reconstruct.mjs')
			)
		).toBe(true)
	})

	it('Bun plugin swaps sucrose only when handler replay is proven safe', async () => {
		const safe = await Bun.build({
			entrypoints: ['test/aot/fixtures/strip-schema-bundle.ts'],
			plugins: [
				bunAot('test/aot/fixtures/strip-schema-bundle.ts', {
					registerFrom: REGISTER_FROM
				})
			],
			write: false,
			target: 'bun'
		})
		expect(safe.success).toBe(true)
		const safeOutput = await safe.outputs[0].text()
		expect(safeOutput).toContain('handler compiler JIT was stripped')
		expect(safeOutput).not.toContain('[Sucrose] warning')
		expect(safeOutput).not.toContain('Unsupported content type')
		expect(safeOutput).not.toContain('class ElysiaWS')
		// schema route uses `va`, so the merged reconstruct module is kept
		expect(safeOutput).not.toContain('handler reconstruction was stripped')

		const unsafe = await Bun.build({
			entrypoints: ['test/aot/fixtures/strip-ws-bundle.ts'],
			plugins: [
				bunAot('test/aot/fixtures/strip-ws-bundle.ts', {
					registerFrom: REGISTER_FROM
				})
			],
			write: false,
			target: 'bun'
		})
		expect(unsafe.success).toBe(true)
		const unsafeOutput = await unsafe.outputs[0].text()
		expect(unsafeOutput).not.toContain('handler compiler JIT was stripped')
		expect(unsafeOutput).toContain('[Sucrose] warning')
		expect(unsafeOutput).toContain('Unsupported content type')
		expect(unsafeOutput).toContain('class ElysiaWS')
	})

	it('emitted stripped bundle serves through frozen handlers', async () => {
		const result = await Bun.build({
			entrypoints: [STRIP_E2E_APP],
			plugins: [
				bunAot(STRIP_E2E_APP, {
					registerFrom: REGISTER_FROM,
					strip: 'auto'
				})
			],
			write: false,
			target: 'bun'
		})
		expect(result.success).toBe(true)

		const text = await result.outputs[0].text()
		expect(text).toContain('handler compiler JIT was stripped')
		expect(text).not.toContain('[Sucrose] warning')
		expect(text).not.toContain('Unsupported content type')

		const tmp = resolve(import.meta.dir, `_built.strip.${Date.now()}.mjs`)
		await Bun.write(tmp, text)
		process.env.ELYSIA_AOT_BUILD = '1'

		try {
			const mod: any = await import(tmp)
			delete process.env.ELYSIA_AOT_BUILD

			const ok = await mod.app.handle(post('/body', { hello: 'world' }))
			expect(ok.status).toBe(200)
			await expect(ok.json()).resolves.toEqual({ hello: 'world' })

			const bad = await mod.app.handle(post('/body', { hello: 123 }))
			expect(bad.status).toBe(422)
		} finally {
			delete process.env.ELYSIA_AOT_BUILD
			await rm(tmp, { force: true })
		}
	})
})
