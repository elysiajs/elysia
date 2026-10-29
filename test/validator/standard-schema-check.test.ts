import { describe, expect, it } from 'bun:test'
import * as v from 'valibot'
import { StandardValidator } from '../../src/validator'

describe('Standard Schema Check', () => {
	it('rejects Valibot failures even when they retain a value', () => {
		const schema = v.object({ ok: v.boolean() })
		const value = { ok: 'not a boolean' }
		const result = schema['~standard'].validate(value)
		expect(result).toHaveProperty('value')
		expect(result).toHaveProperty('issues')

		const validator = new StandardValidator(schema)
		expect(validator.Check(value)).toBe(false)
		expect(validator.Errors(value)).not.toHaveLength(0)
		expect(validator.Check({ ok: true })).toBe(true)
	})

	it('accepts a success result with an undefined issues property', () => {
		const validator = new StandardValidator({
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: (value: unknown) => ({ value, issues: undefined })
			}
		})

		expect(validator.Check('ok')).toBe(true)
	})
})
