import { afterEach, describe, expect, it } from 'bun:test'

import { t } from '../../src'
import { Validator } from '../../src/validator'
import { TypeBoxValidator } from '../../src/type/validator'

describe('nested schema defaults', () => {
	afterEach(() => {
		Validator.clear()
	})

	it('applies the default at the nearest missing nesting level', () => {
		const schema = t.Object(
			{
				a: t.Object(
					{ b: t.Number({ default: 3 }) },
					{ default: { b: 2 } }
				)
			},
			{ default: { a: { b: 1 } } }
		)

		const v = new TypeBoxValidator(schema)

		expect(v.precomputeSafe).toBe(true)

		expect(v.FromSync({ a: {} })).toEqual({ a: { b: 3 } })
		expect(v.FromSync({})).toEqual({ a: { b: 2 } })
		expect(v.FromSync(undefined as any)).toEqual({ a: { b: 1 } })
	})

	it('applies matching parent and child defaults consistently', () => {
		const schema = t.Object(
			{
				a: t.Object(
					{ b: t.Number({ default: 2 }) },
					{ default: { b: 2 } }
				)
			},
			{ default: { a: { b: 2 } } }
		)

		const v = new TypeBoxValidator(schema)
		expect(v.FromSync({ a: {} })).toEqual({ a: { b: 2 } })
	})
})
