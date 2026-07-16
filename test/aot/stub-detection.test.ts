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
} from '../../src/plugin/aot/source'
import {
	generateCompiledArtifacts,
	planFromReport,
	STUB_SOURCES
} from '../../src/plugin/aot/core'
import { aot as bunAot } from '../../src/plugin/aot/bun'
import { materialise, materialiseHandlers } from './_manifest'
import { post, req } from '../utils'

const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')
const STRIP_E2E_APP = resolve(import.meta.dir, 'fixtures/strip-e2e-app.ts')

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

/** Handler JIT may be stubbed only when every frozen route can serve without it. */
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

	// WebSocket routes do not call the HTTP handler compiler.
	it('WS-only app: handler JIT is stubbable (WS never reaches sucrose)', async () => {
		const app = new Elysia().ws('/ws', { message: () => {} })
		const r = await analyzeStubbability(app as any)
		expect(r.jit).toBe(true)
		expect(r.stubbable).toBe(true)
		expect(r.reasons).toEqual([])
	})

	it('reports HTTP stubbability for mixed WebSocket and HTTP apps', async () => {
		const app = new Elysia()
			.post(
				'/p',
				{ body: t.Object({ name: t.String() }) },
				({ body }) => body
			)
			.get('/g', () => 'ok')
			.ws('/ws', { message: () => {} })
		const r = await analyzeStubbability(app as any)
		expect(r.jit).toBe(true)
		expect(r.stubbable).toBe(true)
	})

	// Mounted subapps must be built separately or used with strip:false.
	it('treats a captured mount forwarding handler as stubbable', async () => {
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

		// Replay restores both validators and their lazy-group metadata.
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
			reconstruct: false,
			cookie: true,
			trace: true,
			sucrose: true,
			compat: true,
			bridge: false,
			adapter: false,
			isProduction: true
		})

		const inline = await generateCompiledArtifacts(
			'test/aot/fixtures/strip-inline.ts'
		)
		expect(inline.stub).toEqual({
			jit: true,
			ws: true,
			reconstruct: true,
			cookie: true,
			trace: true,
			sucrose: true,
			compat: true,
			bridge: false,
			adapter: false,
			isProduction: true
		})

		const wsOnly = await generateCompiledArtifacts(
			'test/aot/fixtures/strip-ws.ts'
		)
		expect(wsOnly.stub).toEqual({
			jit: true,
			ws: false,
			reconstruct: true,
			cookie: true,
			trace: true,
			sucrose: true,
			// A schema-less WS app needs neither sealed nor wired TypeBox setup.
			compat: false,
			bridge: false,
			adapter: false,
			isProduction: true
		})
	})

	it('strip:true succeeds for a WS-only app (WS reaches no handler JIT)', async () => {
		const built = await generateCompiledArtifacts(
			'test/aot/fixtures/strip-ws.ts',
			{ strip: true }
		)
		expect(built.stub.jit).toBe(true)
		expect(built.stub.ws).toBe(false)
	})

	it('a frozen app with stripped handler JIT serves requests from its manifest', async () => {
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

	it('stub filters match Elysia source and distribution modules', () => {
		expect(
			STUB_SOURCES.jit.some(({ filter }) =>
				filter.test('/x/node_modules/elysia/dist/sucrose.js')
			)
		).toBe(false)
		expect(
			STUB_SOURCES.jit.some(({ filter }) =>
				filter.test('/x/elysia/src/sucrose.ts')
			)
		).toBe(false)
		expect(
			STUB_SOURCES.jit.some(({ filter }) =>
				filter.test(
					'/x/node_modules/elysia/dist/compile/handler/jit.mjs'
				)
			)
		).toBe(true)
		expect(
			STUB_SOURCES.jit.some(({ filter }) =>
				filter.test('/x/elysia/src/compile/handler/jit.ts')
			)
		).toBe(true)
		expect(
			STUB_SOURCES.ws.some(({ filter }) =>
				filter.test('/x/node_modules/elysia/dist/ws/route.mjs')
			)
		).toBe(true)
		expect(
			STUB_SOURCES.ws.some(({ filter }) =>
				filter.test('/x/elysia/src/ws/route.ts')
			)
		).toBe(true)
		expect(
			STUB_SOURCES.reconstruct.some(({ filter }) =>
				filter.test('/x/elysia/src/compile/handler/reconstruct.ts')
			)
		).toBe(true)
		expect(
			STUB_SOURCES.reconstruct.some(({ filter }) =>
				filter.test(
					'/x/node_modules/elysia/dist/compile/handler/reconstruct.mjs'
				)
			)
		).toBe(true)
		expect(
			STUB_SOURCES.cookie.some(({ filter }) =>
				filter.test(
					'/x/node_modules/.pnpm/elysia@2.0.0/node_modules/elysia/dist/cookie/utils.mjs'
				)
			)
		).toBe(true)
		// Filters ignore user modules with matching paths.
		expect(
			STUB_SOURCES.cookie.some(({ filter }) =>
				filter.test('/app/src/cookie/utils.ts')
			)
		).toBe(false)
		expect(
			STUB_SOURCES.ws.some(({ filter }) =>
				filter.test('/app/src/ws/route.ts')
			)
		).toBe(false)
		expect(
			STUB_SOURCES.jit.some(({ filter }) =>
				filter.test('/app/lib/compile/handler/jit.ts')
			)
		).toBe(false)
		// Filters are scoped to Elysia-owned paths.
		expect(
			STUB_SOURCES.trace.some(({ filter }) =>
				filter.test('/x/node_modules/elysia/dist/trace.mjs')
			)
		).toBe(true)
		expect(
			STUB_SOURCES.trace.some(({ filter }) =>
				filter.test('/x/elysia/src/trace.ts')
			)
		).toBe(true)
		expect(
			STUB_SOURCES.trace.some(({ filter }) =>
				filter.test('/x/node_modules/knip/dist/util/trace.js')
			)
		).toBe(false)
		// The memory stub excludes TypeBox and the public sucrose module.
		expect(
			STUB_SOURCES.sucrose.some(({ filter }) =>
				filter.test('/x/node_modules/elysia/dist/memory.mjs')
			)
		).toBe(true)
		expect(
			STUB_SOURCES.sucrose.some(({ filter }) =>
				filter.test('/x/elysia/src/memory.ts')
			)
		).toBe(true)
		expect(
			STUB_SOURCES.sucrose.some(({ filter }) =>
				filter.test(
					'/x/node_modules/typebox/build/system/memory/memory.mjs'
				)
			)
		).toBe(false)
		expect(
			STUB_SOURCES.sucrose.some(({ filter }) =>
				filter.test('/x/elysia/src/sucrose.ts')
			)
		).toBe(false)
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
		expect(safeOutput).not.toContain('handler reconstruction was stripped')
		expect(safeOutput).not.toContain('class TracerHandle')
		expect(safeOutput).not.toContain('class TracerLifecycle')
		expect(safeOutput).not.toContain('clearSucroseCache')

		// WebSocket routes keep the WS runtime while dropping HTTP handler JIT.
		const ws = await Bun.build({
			entrypoints: ['test/aot/fixtures/strip-ws-bundle.ts'],
			plugins: [
				bunAot('test/aot/fixtures/strip-ws-bundle.ts', {
					registerFrom: REGISTER_FROM
				})
			],
			write: false,
			target: 'bun'
		})
		expect(ws.success).toBe(true)
		const wsOutput = await ws.outputs[0].text()
		expect(wsOutput).toContain('handler compiler JIT was stripped')
		expect(wsOutput).not.toContain('[Sucrose] warning')
		expect(wsOutput).toContain('class ElysiaWS')
		expect(wsOutput).not.toContain('class TracerHandle')
		expect(wsOutput).not.toContain('clearSucroseCache')
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

/** Trace can be stubbed only when no reachable handler can emit trace events. */
describe('trace stub gate — live-JIT relaxation (planFromReport)', () => {
	const liveJit = {
		stubbable: false,
		jit: false,
		reasons: ['sucrose']
	} as any

	const plan = (mayTrace: boolean, aliases = new Set<string>()) =>
		planFromReport('auto', liveJit, false, mayTrace, aliases, false, false)
			.plan

	it('live JIT + no trace registered → trace runtime is stubbed', () => {
		const p = plan(false)
		expect(p.trace).toBe(true)
		// the relaxation must not leak into jit-gated stubs
		expect(p.jit).toBe(false)
		expect(p.cookie).toBe(false)
		expect(p.sucrose).toBe(false)
		expect(p.reconstruct).toBe(false)
	})

	it('live JIT + trace registered (or mount present) → trace kept', () => {
		expect(plan(true).trace).toBe(false)
	})

	it('a `tr` alias always keeps the trace runtime, whatever detection said', () => {
		// inconsistent state (a handler traces but no registrar was detected)
		// must fail SAFE: keep the runtime
		expect(plan(false, new Set(['tr'])).trace).toBe(false)
	})
})

describe('trace registrar detection (~hasTrace)', () => {
	it('.trace() sets the flag on the instance', () => {
		const app = new Elysia().trace(() => {})
		expect((app as any)['~hasTrace']).toBe(true)
		expect((new Elysia() as any)['~hasTrace']).toBeUndefined()
	})

	it('scoped .trace() and guard({ trace }) set the flag', () => {
		const scoped = new Elysia().trace('global', () => {})
		expect((scoped as any)['~hasTrace']).toBe(true)

		// guard-carried trace handlers bypass .trace() (they enter through
		// the hook-push path) but still run — detection must see them
		const guarded = new Elysia()
			.guard({ trace: () => {} } as any)
			.get('/', () => 'ok')
		expect((guarded as any)['~hasTrace']).toBe(true)
	})

	it('a plugin registering trace propagates the flag through .use()', () => {
		const plugin = new Elysia().trace(() => {})
		const app = new Elysia().use(plugin).get('/', () => 'ok')
		expect((app as any)['~hasTrace']).toBe(true)
	})
})
