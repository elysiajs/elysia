import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { compileToSource } from '../../src/plugin/source'

/**
 * Under seal, typebox/value `Errors()` is dropped from the bundle and returns []
 * (validator.ts), so validation error detail must be resolved via the baked
 * `findCustomError` locator (the `ce` manifest channel) AS IF in production —
 * regardless of NODE_ENV / allowUnsafeValidationDetails (error.ts `resolve()`).
 *
 * Without that, a sealed 422 silently degrades to `{ property:'root', errors:[] }`
 * and DROPS a field's custom `error` message, diverging from plain. This pins that
 * a sealed app preserves the custom message (matching plain) on both the
 * NODE_ENV-unset path and the allowUnsafeValidationDetails path.
 */

const G = globalThis as any

afterEach(() => {
	Compiled.clear()
	Validator.clear()
	G.ELY_SEALED = undefined
	delete process.env.ELYSIA_AOT_BUILD
})

const evalManifest = (src: string): any =>
	new Function(
		src
			.replace('export const validators', 'const validators')
			.replace('export const handlers', 'const handlers')
			.replace('export default validators', 'return validators')
			.replace(/^import .*$/gm, '')
	)()

const errBody = async (make: () => any) => {
	process.env.ELYSIA_AOT_BUILD = '1'
	const src = await compileToSource(make() as any, {
		register: false,
		seal: true
	})
	delete process.env.ELYSIA_AOT_BUILD

	const run = async () => {
		const app: any = make()
		app.compile()
		const r = await app.handle(
			new Request('http://localhost/b', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ age: 'x' })
			})
		)
		return { status: r.status, body: await r.text() }
	}

	Compiled.clear()
	Validator.clear()
	Compiled.validators = evalManifest(src)
	G.ELY_SEALED = true
	const sealed = await run()

	G.ELY_SEALED = undefined
	Compiled.clear()
	Validator.clear()
	const plain = await run()

	return { sealed, plain }
}

const customErr = (make: (E: typeof Elysia) => any) => () =>
	make(Elysia).post(
		'/b',
		{ body: t.Object({ age: t.Number({ error: 'AGE_MUST_BE_NUMBER' }) }) },
		({ body }: any) => body
	)

describe('seal — validation error detail matches plain (custom message preserved)', () => {
	it('preserves a field custom error message under seal', async () => {
		const { sealed, plain } = await errBody(
			customErr((E) => new E())
		)

		expect(sealed.status).toBe(422)
		expect(plain.status).toBe(422)
		// the custom message survives the seal — without the fix it degrades to a
		// generic `{ property:'root', message:'Validation error on body', errors:[] }`
		expect(sealed.body).toContain('AGE_MUST_BE_NUMBER')
		expect(sealed.body).toBe(plain.body)
	})

	it('preserves the custom message under seal even with allowUnsafeValidationDetails', async () => {
		const { sealed } = await errBody(
			customErr((E) => new E({ allowUnsafeValidationDetails: true }))
		)

		expect(sealed.status).toBe(422)
		// allowUnsafe bypasses the production gate in a plain build; under seal the
		// baked locator is used regardless, so the message is still recovered.
		expect(sealed.body).toContain('AGE_MUST_BE_NUMBER')
	})
})
