import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import {
	Compiled,
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot'
import { compileToSource } from '../../src/plugin/source'
import { materialise, materialiseHandlers } from './_manifest'
import { post, req } from '../utils'

/**
 * AOT handler freeze (step 1: capture + emit + bind).
 *
 * `compileHandler` normally `new Function`s the per-route pipeline. The build
 * captures `{alias, code}`; the runtime binds the emitted factory with the live
 * `(handler, ...params)` instead of eval'ing — eval-free, so it runs on Cloudflare
 * (where request-time `new Function` is banned). The `alias`-match guard means a
 * config drift falls back to `new Function` rather than mis-binding.
 */

beforeEach(() => {
	process.env.ELYSIA_AOT_BUILD = '1' // capture mode
	// Drain capture leaked by other AOT tests: they compile apps under the same
	// env but only drain validators, so `handlerCapture` would accumulate here.
	endValidatorCapture()
	endHandlerCapture()
})
afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

// Hook + validation + response → params.size > 1 → goes through `new Function`
// (not the `createInlineHandler` fast path), so there's a handler to freeze.
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
	it('binds the frozen factory (no new Function) and behaves identically to JIT', async () => {
		// ── capture (env set by beforeEach) ─────────────────────────────────
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()

		expect(handlers.length).toBe(1) // the /x handler was captured
		expect(handlers[0]!.method).toBe('POST')
		expect(handlers[0]!.path).toBe('/x')
		expect(handlers[0]!.alias.length).toBeGreaterThan(0) // has deps (hook/validators)

		// ── register, spying the factory so we can prove it was bound ───────
		const manifest = materialiseHandlers(handlers)
		let factoryCalls = 0
		const realF = manifest.POST!['/x']!.f
		manifest.POST!['/x']!.f = (...a: unknown[]) => {
			factoryCalls++
			return realF(...a)
		}

		Validator.clear()
		Compiled.validators = materialise(validators)
		Compiled.handlers = manifest
		expect(Compiled.handlers?.POST?.['/x']).toBeDefined()

		// ── frozen run (no build env) ───────────────────────────────────────
		delete process.env.ELYSIA_AOT_BUILD
		const frozenApp = build()
		;(frozenApp as any).compile()
		expect(factoryCalls).toBe(1) // the frozen factory bound — NOT `new Function`

		const frozen = await frozenApp.handle(post('/x', { n: 5 }))
		expect(frozen.status).toBe(200)
		await expect(frozen.json()).resolves.toEqual({ ok: true, n: 5 })

		// ── JIT reference (no manifest) — same behaviour ────────────────────
		Compiled.clear()
		Validator.clear()
		const jitApp = build()
		;(jitApp as any).compile()
		const jit = await jitApp.handle(post('/x', { n: 5 }))
		expect(jit.status).toBe(200)
		await expect(jit.json()).resolves.toEqual({ ok: true, n: 5 })
	})

	it('trusts the manifest alias and fails loud on a corrupt one', () => {
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		endValidatorCapture()

		// The full freeze skips codegen, so there's no runtime alias to compare —
		// it trusts the captured `a` (deterministic + completeness-tested). A corrupt
		// name has no ParamDescriptor, so it throws at compile (fail loud) rather
		// than mis-binding. Normal operation never hits this.
		const manifest = materialiseHandlers(handlers)
		manifest.POST!['/x']!.a = ['bogus']
		Validator.clear()
		Compiled.handlers = manifest

		delete process.env.ELYSIA_AOT_BUILD
		expect(() => (build() as any).compile()).toThrow(
			/Fail to reconstruct build/
		)
	})
})

/**
 * Same-shape routes share ONE handler pipeline (the schemas live in the
 * validators, referenced by param — not inlined in the handler code). The emit
 * must dedup the factory `_h`, the alias array `_a`, AND the `{ a, f }` wrapper
 * `_w`, leaving the route tree as bare `_w` refs (no per-route object/array).
 */
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

		// one of each, despite three routes
		expect((src.match(/const _h\d+ =/g) ?? []).length).toBe(1)
		expect((src.match(/const _a\d+ =/g) ?? []).length).toBe(1)
		expect((src.match(/const _w\d+ =/g) ?? []).length).toBe(1)
		// the wrapper holds a REFERENCE to the alias array, not an inline literal
		expect(src).toMatch(/_w0 = \{ a: _a0, f: _h0 \}/)
		// all three routes point at the same shared wrapper
		expect((src.match(/: _w0\b/g) ?? []).length).toBe(3)
	})
})

/**
 * Static-value and Promise handlers that carry a blocking hook
 * (parse/transform/beforeHandle/afterHandle) bypass `buildNativeStaticResponse`,
 * so without freezing they fall through to `compileHandler`'s `new Function` tail
 * at runtime — an `EvalError` on Cloudflare. The freeze must cover them too, not
 * just `typeof handler === 'function'` routes. These tests guard that hole.
 */
describe('AOT static & promise handler freeze', () => {
	const build = () =>
		new Elysia()
			.get('/s', { beforeHandle() {} }, 'hello') // static value + blocking hook
			.get('/p', { beforeHandle() {} }, Promise.resolve('hi') as any) // promise + hook

	it('captures static-value and Promise handlers, not just functions', () => {
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		endValidatorCapture()

		// Before the fix only function handlers were captured — these were absent.
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
		Compiled.handlers = manifest

		// ── frozen run (no build env) ───────────────────────────────────────
		delete process.env.ELYSIA_AOT_BUILD
		const frozenApp = build()
		;(frozenApp as any).compile()
		expect(calls['/s']).toBe(1) // frozen factory bound — NOT `new Function`
		expect(calls['/p']).toBe(1)

		const s = await frozenApp.handle(req('/s'))
		const p = await frozenApp.handle(req('/p'))
		expect(s.status).toBe(200)
		await expect(s.text()).resolves.toBe('hello')
		expect(p.status).toBe(200)
		await expect(p.text()).resolves.toBe('hi')

		// ── JIT reference (no manifest) — same behaviour ────────────────────
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
