import '../../src/compile/aot-capture'
import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { TypeBoxValidator } from '../../src/type/validator'
import { Compiled } from '../../src/compile/aot'
import {
	beginValidatorCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { claimManifest, materialise, registerManifest } from './_manifest'
import { req } from '../utils'

/** Frozen codec validators clean values the same way as runtime validators. */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const captureDirect = (schema: any, path: string) => {
	beginValidatorCapture()
	new TypeBoxValidator(schema, {
		aot: { method: 'GET', path },
		slot: 'query'
	})
	return materialise(endValidatorCapture())
}

const tb = t as any

const SHAPES: Array<{ name: string; make: () => any; inputs: unknown[] }> = [
	{
		name: 'Numeric',
		make: () => t.Object({ page: t.Numeric(), limit: t.Numeric() }),
		inputs: [
			{ page: 3, limit: 10, extra: 'x' },
			{ page: '3', limit: '10' },
			{ page: 3 }
		]
	},
	{
		name: 'Numeric + plain + nested',
		make: () =>
			t.Object({
				n: t.Numeric(),
				s: t.String(),
				meta: t.Object({ m: t.Numeric() })
			}),
		inputs: [
			{ n: 1, s: 'a', meta: { m: 2, junk: 1 }, top: 9 },
			{ n: '5', s: 'b', meta: { m: '3' } }
		]
	},
	{
		name: 'array of Numeric',
		make: () => t.Object({ xs: t.Array(t.Numeric()) }),
		inputs: [{ xs: [1, '2', 3], drop: 1 }, { xs: [] }]
	},
	{
		name: 'optional Numeric',
		make: () => t.Object({ o: t.Optional(t.Numeric()), k: t.String() }),
		inputs: [{ k: 'a' }, { o: '5', k: 'b', x: 1 }]
	},
	{
		name: 'Date',
		make: () => t.Object({ d: t.Date() }),
		inputs: [{ d: new Date(0), z: 1 }, { d: '2020-01-01' }]
	},
	{
		name: 'BooleanString',
		make: () => t.Object({ b: tb.BooleanString() }),
		inputs: [{ b: true, j: 1 }, { b: 'true' }]
	}
]

describe('frozen codec cleaning', () => {
	for (const { name, make, inputs } of SHAPES)
		it(`${name}: matches runtime cleaning`, () => {
			const path = `/${name.replace(/\W/g, '')}`
			const m = captureDirect(make(), path)
			expect(m.GET?.[path]?.query?.cm).toBeDefined()

			Compiled.clear()
			Validator.clear()
			const jit = new TypeBoxValidator(make()) as any

			Validator.clear()
			const frozen = Validator.create(make() as any, {
				aot: { method: 'GET', path },
				slot: 'query',
				frozen: m.GET![path]!.query
			}) as any

			expect(frozen.tb).toBeUndefined()
			for (const input of inputs)
				expect(frozen.Clean(structuredClone(input))).toEqual(
					jit.Clean(structuredClone(input))
				)
		})

	it('normalizes and coerces values on a real route', async () => {
		const build = () =>
			new Elysia().get(
				'/q',
				{
					query: t.Object({ page: t.Numeric(), limit: t.Numeric() })
				},
				({ query }) => query
			)
		beginValidatorCapture()
		build().compile()
		const m = materialise(endValidatorCapture())
		Validator.clear()
		registerManifest({ validators: m }, build())

		const app = build()
		app.compile()
		const ok = await app.handle(req('/q?page=3&limit=10&extra=strip'))
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ page: 3, limit: 10 })
		const bad = await app.handle(req('/q?page=abc&limit=10'))
		expect(bad.status).toBe(422)
	})
})
