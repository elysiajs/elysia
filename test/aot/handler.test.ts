import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { validationPlan } from '../../src/experimental/validation-plan'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot-capture'
import { compileToSource } from '../../src/plugin/aot/source'
import { materialise, materialiseHandlers, registerManifest } from './_manifest'
import { post, req } from '../utils'

/** Captured handlers bind emitted factories without request-time evaluation. */

beforeEach(() => {
	process.env.ELYSIA_AOT_BUILD = '1' // capture mode
	// Isolate the shared capture registries from other AOT tests.
	endValidatorCapture()
	endHandlerCapture()
})
afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

// Force the generated-handler path rather than the inline fast path.
const build = () =>
	new Elysia()
		.beforeHandle(() => {})
		.post(
			'/x',
			{
				body: t.Object({ n: t.Number() }),
				response: { 200: t.Object({ ok: t.Boolean(), n: t.Number() }) }
			},
			({ body }: any) => ({ ok: true, n: body.n })
		)

describe('AOT handler freeze', () => {
	it('binds the captured Q12 settlement helper', async () => {
		const buildQ12 = () =>
			new Elysia().beforeHandle(() => {}).get('/q12', () => 'ok')

		;(buildQ12() as any).compile()
		const handlers = endHandlerCapture()
		endValidatorCapture()

		expect(handlers).toHaveLength(1)
		expect(handlers[0]!.alias.split(',')).toContain('s')
		registerManifest({ handlers: materialiseHandlers(handlers) })

		delete process.env.ELYSIA_AOT_BUILD
		const app = buildQ12()
		;(app as any).compile()
		await expect((await app.handle(req('/q12'))).text()).resolves.toBe('ok')
	})

	it('binds the frozen factory (no new Function) and behaves identically to JIT', async () => {
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()

		expect(handlers.length).toBe(1)
		expect(handlers[0]!.method).toBe('POST')
		expect(handlers[0]!.path).toBe('/x')
		expect(handlers[0]!.alias.length).toBeGreaterThan(0)

		const manifest = materialiseHandlers(handlers)
		let factoryCalls = 0
		const realF = manifest.POST!['/x']!.f
		manifest.POST!['/x']!.f = (...a: unknown[]) => {
			factoryCalls++
			return realF(...a)
		}

		Validator.clear()
		registerManifest({
			validators: materialise(validators),
			handlers: manifest
		})
		expect(manifest.POST?.['/x']).toBeDefined()

		delete process.env.ELYSIA_AOT_BUILD
		const frozenApp = build()
		;(frozenApp as any).compile()
		expect(factoryCalls).toBe(1)

		const frozen = await frozenApp.handle(post('/x', { n: 5 }))
		expect(frozen.status).toBe(200)
		await expect(frozen.json()).resolves.toEqual({ ok: true, n: 5 })

		Compiled.clear()
		Validator.clear()
		const jitApp = build()
		;(jitApp as any).compile()
		const jit = await jitApp.handle(post('/x', { n: 5 }))
		expect(jit.status).toBe(200)
		await expect(jit.json()).resolves.toEqual({ ok: true, n: 5 })
	})

	it('binds the shared fallback when reconstructing the error tail', async () => {
		const previousNodeEnv = process.env.NODE_ENV
		const buildError = () =>
			new Elysia()
				.error(() => {})
				.get('/status', () => {
					const error: any = new Error('upstream unavailable')
					error.status = 503
					throw error
				})

		try {
			process.env.NODE_ENV = 'development'
			;(buildError() as any).compile()
			const handlers = endHandlerCapture()
			endValidatorCapture()

			expect(handlers).toHaveLength(1)
			expect(handlers[0]!.alias.split(',')).toContain('fr')
			registerManifest({ handlers: materialiseHandlers(handlers) })

			delete process.env.ELYSIA_AOT_BUILD
			const frozen = buildError()
			;(frozen as any).compile()

			const development = await frozen.handle(req('/status'))
			expect(development.status).toBe(503)
			await expect(development.text()).resolves.toBe(
				'upstream unavailable'
			)

			process.env.NODE_ENV = 'production'
			const production = await frozen.handle(req('/status'))
			expect(production.status).toBe(503)
			await expect(production.text()).resolves.toBe(
				'Internal Server Error'
			)
		} finally {
			if (previousNodeEnv === undefined) delete process.env.NODE_ENV
			else process.env.NODE_ENV = previousNodeEnv
		}
	})

	it('trusts the manifest alias and fails loud on a corrupt one', () => {
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		endValidatorCapture()

		// A corrupt alias must fail compilation instead of binding the wrong value.
		const manifest = materialiseHandlers(handlers)
		manifest.POST!['/x']!.a = ['bogus']
		Validator.clear()
		registerManifest({ handlers: manifest })

		delete process.env.ELYSIA_AOT_BUILD
		expect(() => (build() as any).compile()).toThrow(
			/Fail to reconstruct build/
		)
	})

	it('rebuilds the experimental query plan through the validator binding', async () => {
		const buildQuery = () =>
			new Elysia({ experimental: { validationPlan } })
				.beforeHandle(() => {})
				.get(
					'/query',
					{ query: t.Object({ id: t.Array(t.String()) }) },
					({ query }) => query
				)

		;(buildQuery() as any).compile()
		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()
		const aliases = handlers[0]!.alias.split(',')

		expect(aliases).toContain('va')
		expect(aliases).not.toContain('qa')
		expect(aliases).not.toContain('qo')
		expect(aliases).not.toContain('pq')

		registerManifest({
			validators: materialise(validators),
			handlers: materialiseHandlers(handlers)
		})
		delete process.env.ELYSIA_AOT_BUILD

		const app = buildQuery()
		;(app as any).compile()
		const response = await app.handle(req('/query?id=a&id=b'))
		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({ id: ['a', 'b'] })
	})
})

/** Same-shape routes share their factory, aliases, and manifest wrapper. */
describe('AOT handler emit dedup', () => {
	it('shares the factory, alias, and wrapper across same-shape routes', async () => {
		const app = new Elysia()
			.beforeHandle(() => {})
			.post(
				'/a',
				{
					body: t.Object({ a: t.String() })
				},
				({ body }: any) => body
			)
			.post(
				'/b',
				{
					body: t.Object({ b: t.String() })
				},
				({ body }: any) => body
			)
			.post(
				'/c',
				{
					body: t.Object({ c: t.String() })
				},
				({ body }: any) => body
			)

		const src = await compileToSource(app as any, { register: false })
		delete process.env.ELYSIA_AOT_BUILD

		expect((src.match(/const _h\d+ =/g) ?? []).length).toBe(1)
		expect((src.match(/const _a\d+ =/g) ?? []).length).toBe(1)
		expect((src.match(/const _w\d+ =/g) ?? []).length).toBe(1)
		expect(src).toMatch(/_w0 = \{ a: _a0, f: _h0 \}/)
		expect((src.match(/: _w0\b/g) ?? []).length).toBe(3)
	})
})

/** Static and Promise handlers with lifecycle hooks must also be captured. */
describe('AOT static & promise handler freeze', () => {
	const build = () =>
		new Elysia()
			.get('/s', { beforeHandle() {} }, 'hello') // static value + blocking hook
			.get('/p', { beforeHandle() {} }, Promise.resolve('hi') as any) // promise + hook

	it('captures static-value and Promise handlers, not just functions', () => {
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		endValidatorCapture()

		expect(handlers.map((h) => h.path).sort()).toEqual(['/p', '/s'])
		expect(handlers.every((h) => h.method === 'GET')).toBe(true)
	})

	it('binds the frozen factory (no new Function) and behaves identically to JIT', async () => {
		;(build() as any).compile()
		const captured = endHandlerCapture()
		endValidatorCapture()

		const manifest = materialiseHandlers(captured)
		const calls: Record<string, number> = { '/s': 0, '/p': 0 }
		for (const p of ['/s', '/p'] as const) {
			const realF = manifest.GET![p]!.f
			manifest.GET![p]!.f = (...a: unknown[]) => {
				calls[p]++
				return realF(...a)
			}
		}

		Validator.clear()
		registerManifest({ handlers: manifest })

		delete process.env.ELYSIA_AOT_BUILD
		const frozenApp = build()
		;(frozenApp as any).compile()
		expect(calls['/s']).toBe(1)
		expect(calls['/p']).toBe(1)

		const s = await frozenApp.handle(req('/s'))
		const p = await frozenApp.handle(req('/p'))
		expect(s.status).toBe(200)
		await expect(s.text()).resolves.toBe('hello')
		expect(p.status).toBe(200)
		await expect(p.text()).resolves.toBe('hi')

		Compiled.clear()
		Validator.clear()
		const jitApp = build()
		;(jitApp as any).compile()
		const js = await jitApp.handle(req('/s'))
		const jp = await jitApp.handle(req('/p'))
		expect(js.status).toBe(200)
		await expect(js.text()).resolves.toBe('hello')
		expect(jp.status).toBe(200)
		await expect(jp.text()).resolves.toBe('hi')
	})
})

/** Promise-returning hooks require async handlers; provably sync hooks do not. */
describe('sync/async compilation gating', () => {
	const capture = (app: Elysia<any, any>) => {
		;(app as any).compile()
		const handlers = endHandlerCapture()
		endValidatorCapture()
		return handlers
	}

	const codeFor = (
		handlers: { method: string; path: string; code: string }[],
		method: string,
		path: string
	) => handlers.find((h) => h.method === method && h.path === path)?.code

	const isAsyncRoute = (code: string | undefined) =>
		!!code && /async\s+function route\(/.test(code)

	it('keeps a plain sync route synchronous', () => {
		const handlers = capture(
			new Elysia().get(
				'/x',
				{ beforeHandle: () => {} },
				() => 'hi'
			) as any
		)
		expect(isAsyncRoute(codeFor(handlers, 'GET', '/x'))).toBe(false)
	})

	it('keeps a sync value-returning error hook synchronous', () => {
		const handlers = capture(
			new Elysia()
				.error(() => 'oops')
				.get('/x', () => {
					throw new Error('boom')
				}) as any
		)
		expect(isAsyncRoute(codeFor(handlers, 'GET', '/x'))).toBe(false)
	})

	it('promotes a beforeHandle that returns new Promise() to async', () => {
		const handlers = capture(
			new Elysia().get(
				'/x',
				{
					beforeHandle: () =>
						new Promise<void>((resolve) => resolve()) as any
				},
				() => 'hi'
			) as any
		)
		expect(isAsyncRoute(codeFor(handlers, 'GET', '/x'))).toBe(true)
	})

	it('promotes an error hook that returns new Promise() to async', () => {
		const handlers = capture(
			new Elysia()
				.error(() => new Promise<void>((resolve) => resolve()) as any)
				.get('/x', () => {
					throw new Error('boom')
				}) as any
		)
		expect(isAsyncRoute(codeFor(handlers, 'GET', '/x'))).toBe(true)
	})
})
