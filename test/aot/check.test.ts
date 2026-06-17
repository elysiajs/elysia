import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import {
	Compiled,
	beginValidatorCapture,
	endValidatorCapture,
	type ValidatorManifest
} from '../../src/compile/aot'
import { materialise } from './_manifest'
import { post } from '../utils'

/**
 * AOT check freeze — freeze the TypeBox **check** for empty-external schemas, keyed
 * by route identity `(method, path, slot)`. Capture at build, bind at runtime,
 * skip `Compile`. Coerced/codec checks (non-empty externals) live in `coerce.test.ts`.
 */

// Force-compile every route under a capture pass and materialise the frozen
// manifest as real functions — exactly what the build plugin will emit.
const captureManifest = (build: () => any): ValidatorManifest => {
	beginValidatorCapture()
	build().compile() // compile() → handler(i, true) for every route
	const captured = endValidatorCapture()

	return materialise(captured)
}

const bodyApp = () =>
	new Elysia().post(
		'/body',
		{
			body: t.Object({ hello: t.String() })
		},
		({ body }) => body
	)

// Each test starts from a clean registry + validator cache (a real runtime boots
// with an empty cache; capture in the same process would otherwise pollute it).
afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

describe('AOT check freeze (TypeBox check, empty externals)', () => {
	it('captures an empty-external body check by route identity', () => {
		const m = captureManifest(bodyApp)
		expect(m.POST?.['/body']?.body).toBeDefined()
		// body freezes BOTH check + mirror → merged `cm` factory
		expect(typeof m.POST!['/body']!.body!.cm).toBe('function')
	})

	it('also freezes a coerced query (externals reconstructed)', () => {
		const m = captureManifest(() =>
			new Elysia().get(
				'/q',
				{
					query: t.Object({ id: t.Numeric() })
				},
				({ query }) => query
			)
		)
		// externals reconstructable + verified → frozen (was excluded in phase 1)
		expect(m.GET?.['/q']?.query).toBeDefined()
	})

	it('binds the frozen check at runtime (Compile skipped) and serves', async () => {
		const m = captureManifest(bodyApp)
		Validator.clear() // simulate a fresh runtime process

		let frozenBound = false
		const orig = m.POST!['/body']!.body!.cm!
		m.POST!['/body']!.body!.cm = ((...d: any[]) => {
			frozenBound = true
			return (orig as any)(...d)
		}) as any
		Compiled.validators = m

		const app = bodyApp()
		app.compile()
		expect(frozenBound).toBe(true) // bound eagerly at construction (compile)

		const ok = await app.handle(post('/body', { hello: 'world' }))
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ hello: 'world' })

		const bad = await app.handle(post('/body', { hello: 123 }))
		expect(bad.status).toBe(422) // frozen check rejects wrong type
	})

	it('unit: a frozen-bound validator has no tb and validates correctly', () => {
		const m = captureManifest(bodyApp)
		Validator.clear()
		Compiled.validators = m

		const v = Validator.create(t.Object({ hello: t.String() }) as any, {
			aot: { method: 'POST', path: '/body' },
			slot: 'body'
		}) as any

		expect(v.tb).toBeUndefined() // Compile skipped
		expect(v.reconstructedCheck).toBeDefined() // bound eagerly at construction
		expect(v.Check({ hello: 'x' })).toBe(true)
		expect(v.Check({ hello: 1 })).toBe(false)
		expect(v.Check({})).toBe(false)
	})

	it('falls back to JIT when no manifest is registered', async () => {
		const app = bodyApp()
		const ok = await app.handle(post('/body', { hello: 'x' }))
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ hello: 'x' })
	})
})

/**
 * Reconstruction reads typebox / exact-mirror INTERNALS (External order, factory
 * signature, d.unions). A library upgrade that changes them makes reconstruction
 * fail — which is FAIL-SAFE (the build-time `externalsMatch` check refuses to
 * freeze and the route falls back to JIT) but SILENT (the entry just goes absent).
 * This pins that the family still FREEZES, so an upgrade that breaks it fails CI
 * instead of silently shipping a slow / eval-using build.
 */
describe('AOT freeze coverage (guards silent JIT fallback on lib upgrade)', () => {
	it('freezes the whole schema family — a missing entry means reconstruction broke', () => {
		beginValidatorCapture()
		;(
			new Elysia()
				.post(
					'/obj',
					{
						body: t.Object({ s: t.String(), n: t.Number() })
					},
					({ body }: any) => body
				)
				.post(
					'/arr',
					{
						body: t.Object({ xs: t.Array(t.String()) })
					},
					({ body }: any) => body
				)
				.get(
					'/codec',
					{
						query: t.Object({ n: t.Numeric() })
					},
					({ query }: any) => query
				)
				.post(
					'/format',
					{
						body: t.Object({ email: t.String({ format: 'email' }) })
					},
					({ body }: any) => body
				)
				.post(
					'/nested',
					{
						body: t.Object({ meta: t.Object({ x: t.Number() }) })
					},
					({ body }: any) => body
				)
				.post(
					'/optional',
					{
						body: t.Object({ o: t.Optional(t.String()) })
					},
					({ body }: any) => body
				) as any
		).compile()
		const captured = endValidatorCapture()

		const at = (method: string, path: string, slot: string) =>
			captured.find(
				(c) => c.method === method && c.path === path && c.slot === slot
			)

		// every slot must produce a frozen CHECK — absent ⇒ silent JIT fallback
		for (const [m, p, s] of [
			['POST', '/obj', 'body'],
			['POST', '/arr', 'body'],
			['GET', '/codec', 'query'],
			['POST', '/format', 'body'],
			['POST', '/nested', 'body'],
			['POST', '/optional', 'body']
		] as const) {
			const c = at(m, p, s)
			expect(
				c,
				`${m} ${p} ${s} should freeze (absent = JIT fallback)`
			).toBeDefined()
			expect(c!.checkValue).toBeDefined()
		}

		// the codec query must also freeze its exact-mirror (d.unions reconstructed)
		expect(at('GET', '/codec', 'query')!.mirror).toBeDefined()
	})
})
