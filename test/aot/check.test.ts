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
	new Elysia().post('/body', ({ body }) => body, {
		body: t.Object({ hello: t.String() })
	})

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
		expect(typeof m.POST!['/body']!.body!.c).toBe('function')
	})

	it('also freezes a coerced query (externals reconstructed)', () => {
		const m = captureManifest(() =>
			new Elysia().get('/q', ({ query }) => query, {
				query: t.Object({ id: t.Numeric() })
			})
		)
		// externals reconstructable + verified → frozen (was excluded in phase 1)
		expect(m.GET?.['/q']?.query).toBeDefined()
	})

	it('binds the frozen check at runtime (Compile skipped) and serves', async () => {
		const m = captureManifest(bodyApp)
		Validator.clear() // simulate a fresh runtime process

		let frozenBound = false
		const orig = m.POST!['/body']!.body!.c!
		m.POST!['/body']!.body!.c = ((...d: any[]) => {
			frozenBound = true
			return (orig as any)(...d)
		}) as any
		Compiled.validators = m

		const app = bodyApp()
		app.compile()
		expect(frozenBound).toBe(false) // deferred — factory not invoked at compile

		const ok = await app.handle(post('/body', { hello: 'world' }))
		expect(frozenBound).toBe(true) // bound on first validation (parse deferred off compile)
		expect(ok.status).toBe(200)
		expect(await ok.json()).toEqual({ hello: 'world' })

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
		expect(v.reconstructedCheck).toBeUndefined() // deferred — not bound until first Check
		expect(v.Check({ hello: 'x' })).toBe(true)
		expect(v.reconstructedCheck).toBeDefined() // instantiated lazily (parse off the boot path)
		expect(v.Check({ hello: 1 })).toBe(false)
		expect(v.Check({})).toBe(false)
	})

	it('falls back to JIT when no manifest is registered', async () => {
		const app = bodyApp()
		const ok = await app.handle(post('/body', { hello: 'x' }))
		expect(ok.status).toBe(200)
		expect(await ok.json()).toEqual({ hello: 'x' })
	})
})
