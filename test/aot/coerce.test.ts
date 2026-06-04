import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { TypeBoxValidator } from '../../src/type/validator'
import {
	Compiled,
	beginValidatorCapture,
	endValidatorCapture,
	type ValidatorManifest
} from '../../src/compile/aot'
import { materialise } from './_manifest'
import { req } from '../utils'

/**
 * AOT coerce freeze — freeze coerced/codec checks (non-empty externals) by rebuilding
 * `External[]` from the live schema (build-verified). The runtime walk and the
 * verification share `collectExternals`, so they always agree.
 */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

// Capture by constructing TypeBoxValidator directly (no route coercion), so a
// reference `new TypeBoxValidator(schema)` is an apples-to-apples comparison.
const captureDirect = (
	schema: any,
	method: string,
	path: string,
	slot: string
): ValidatorManifest => {
	beginValidatorCapture()
	new TypeBoxValidator(schema, {
		aot: { method, path },
		slot: slot as any
	})
	return materialise(endValidatorCapture())
}

describe('AOT coerce freeze (coerced/codec checks, externals reconstructed)', () => {
	it('end-to-end: a frozen coerced query coerces and validates', async () => {
		const build = () =>
			new Elysia().get('/q', ({ query }) => query, {
				query: t.Object({ page: t.Numeric(), limit: t.Numeric() })
			})

		// capture through the real route (query coercion applied)
		beginValidatorCapture()
		build().compile()
		const m = materialise(endValidatorCapture())
		expect(m.GET?.['/q']?.query).toBeDefined() // coerced query frozen

		Validator.clear()
		Compiled.validators = m
		const app = build()
		app.compile()

		const ok = await app.handle(req('/q?page=3&limit=10'))
		expect(ok.status).toBe(200)
		expect(await ok.json()).toEqual({ page: 3, limit: 10 }) // coerced to numbers

		const bad = await app.handle(req('/q?page=abc&limit=10'))
		expect(bad.status).toBe(422)
	})

	const SHAPES: Array<{ name: string; make: () => any; inputs: unknown[] }> =
		[
			{
				name: 'codec (Numeric)',
				make: () => t.Object({ a: t.Numeric() }),
				inputs: [{ a: 1 }, { a: '2' }, { a: 'x' }, {}, { a: true }]
			},
			{
				name: 'pattern',
				make: () => t.Object({ s: t.String({ pattern: '^a.*z$' }) }),
				inputs: [{ s: 'abcz' }, { s: 'az' }, { s: 'bz' }, { s: 1 }]
			},
			{
				name: 'optional + pattern',
				make: () =>
					t.Object({
						n: t.Optional(t.Numeric()),
						p: t.String({ pattern: '^t' })
					}),
				inputs: [
					{ p: 'tx' },
					{ n: '5', p: 'tx' },
					{ n: 1, p: 'zz' },
					{}
				]
			},
			{
				name: 'array of codec',
				make: () => t.Object({ xs: t.Array(t.Numeric()) }),
				inputs: [{ xs: [1, '2'] }, { xs: ['x'] }, { xs: [] }, { xs: 5 }]
			},
			{
				name: 'two codecs + pattern (order-sensitive)',
				make: () =>
					t.Object({
						page: t.Numeric(),
						limit: t.Numeric(),
						slug: t.String({ pattern: '^[a-z]+$' })
					}),
				inputs: [
					{ page: '1', limit: 2, slug: 'abc' },
					{ page: 'x', limit: 2, slug: 'abc' },
					{ page: 1, limit: 2, slug: 'AB' }
				]
			}
		]

	for (const { name, make, inputs } of SHAPES)
		it(`differential: ${name} — frozen ≡ compiled`, () => {
			const path = `/${name.replace(/\W/g, '')}`
			const m = captureDirect(make(), 'GET', path, 'query')

			Compiled.clear()
			Validator.clear()
			const compiled = new TypeBoxValidator(make()) // reference (Compile)

			Validator.clear()
			Compiled.validators = m
			const frozen = Validator.create(make() as any, {
				aot: { method: 'GET', path },
				slot: 'query'
			}) as any

			expect(frozen.tb).toBeUndefined() // Compile skipped
			for (const input of inputs)
				expect(frozen.Check(input)).toBe(compiled.Check(input as any))
		})
})
