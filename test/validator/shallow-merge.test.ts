import { describe, expect, it } from 'bun:test'
import { Check, Errors } from 'typebox/value'

import { t } from '../../src'
import { validationPlan } from '../../src/experimental/validation-plan'
import { Validator } from '../../src/validator'

const candidate = (options: Record<string, unknown>) =>
	({
		...options,
		app: { '~config': { experimental: { validationPlan } } }
	}) as any

// Q10 keeps author-declared intersections as constraint conjunctions. Only
// route + standalone composition moved to the ordered transform/merge form.
const expectConstraintConjunction = (mk: () => any[], values: unknown[]) => {
	const declared = t.Intersect(mk() as any)
	const validator = Validator.create(declared)!

	expect(validator.constructor.name).toBe('TypeBoxValidator')
	for (const value of values) {
		expect(validator.Check(value)).toBe(Check(declared, value))
		expect(validator.Errors(value).length).toBe(
			[...Errors(declared, value)].length
		)
	}
}

describe('author-declared intersection constraints', () => {
	it('combines disjoint required primitive properties', () => {
		expectConstraintConjunction(
			() => [t.Object({ id: t.Number() }), t.Object({ tok: t.String() })],
			[
				{ id: 5, tok: 'x' },
				{ id: 5 },
				{ tok: 'x' },
				{},
				{ id: 'no', tok: 1 }
			]
		)
	})

	it('preserves a codec property', () => {
		expectConstraintConjunction(
			() => [t.Object({ when: t.Date() }), t.Object({ n: t.Number() })],
			[
				{ when: '2020-01-01T00:00:00.000Z', n: 1 },
				{ when: 'not-a-date', n: 1 },
				{ n: 1 }
			]
		)
	})

	it('combines nested and formatted properties across three members', () => {
		expectConstraintConjunction(
			() => [
				t.Object({ a: t.Object({ b: t.Number() }) }),
				t.Object({ email: t.String({ format: 'email' }) }),
				t.Object({ flag: t.Boolean() })
			],
			[
				{ a: { b: 1 }, email: 'a@b.co', flag: true },
				{ a: { b: 'no' }, email: 'a@b.co', flag: true },
				{ a: { b: 1 }, email: 'nope', flag: true }
			]
		)
	})

	it('preserves optional properties', () => {
		expectConstraintConjunction(
			() => [
				t.Object({ id: t.Number() }),
				t.Object({ maybe: t.Optional(t.String()) })
			],
			[
				{ id: 1 },
				{ id: 1, maybe: 'x' },
				{ id: 1, maybe: 5 },
				{ maybe: 'x' }
			]
		)
	})

	it('preserves nested optional properties', () => {
		expectConstraintConjunction(
			() => [
				t.Object({
					outer: t.Object({ inner: t.Optional(t.Number()) })
				}),
				t.Object({ b: t.String() })
			],
			[
				{ outer: {}, b: 'x' },
				{ outer: { inner: 1 }, b: 'x' },
				{ outer: { inner: 'no' }, b: 'x' },
				{ outer: {} }
			]
		)
	})

	it('preserves defaults on optional properties', () => {
		expectConstraintConjunction(
			() => [
				t.Object({ a: t.Optional(t.Number({ default: 1 })) }),
				t.Object({ b: t.String() })
			],
			[{ b: 'x' }, { a: 5, b: 'x' }, { a: 'no', b: 'x' }]
		)
	})

	it('preserves getter-valued constraints', () => {
		let reads = 0
		const schema = t.Intersect([
			t.Object({
				a: t.Number({
					get minimum() {
						reads++
						return 1000
					}
				})
			}),
			t.Object({ b: t.String() })
		])
		const validator = Validator.create(schema)!

		expect(validator.Check({ a: 5, b: 'x' })).toBe(false)
		expect(validator.Check({ a: 5000, b: 'x' })).toBe(true)
		expect(reads).toBeGreaterThan(0)
	})
})

describe('Q10 composition split', () => {
	it('does not turn route + standalone schemas into a TypeBox intersection', () => {
		const validator = Validator.create(
			t.Object({ a: t.Number() }),
			candidate({
				schemas: [t.Object({ b: t.String() })]
			})
		)!

		expect(validator.constructor.name).toBe('ValidationPlanMultiValidator')
		expect(validator.From!({ a: 1, b: 'x' }, 'body')).toEqual({
			a: 1,
			b: 'x'
		})
	})

	it('enforces overlapping member constraints independently', () => {
		const validator = Validator.create(
			t.Object({ id: t.Number() }),
			candidate({
				schemas: [t.Object({ id: t.Number({ minimum: 10 }) })]
			})
		)!

		expect(() => validator.From!({ id: 5 }, 'body')).toThrow()
		expect(validator.From!({ id: 12 }, 'body')).toEqual({ id: 12 })
	})

	it('keeps object-level constraints on each member', () => {
		const validator = Validator.create(
			t.Object({ a: t.Optional(t.Number()) }, { minProperties: 1 }),
			candidate({
				schemas: [t.Object({ b: t.Optional(t.String()) })]
			})
		)!

		expect(() => validator.From!({}, 'body')).toThrow()
		expect(validator.From!({ a: 1 }, 'body')).toEqual({ a: 1 })
	})
})
