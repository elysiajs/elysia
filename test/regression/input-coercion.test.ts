import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'

import { BooleanString } from '../../src/type/elysia/boolean-string'
import { DateType } from '../../src/type/elysia/date'
import { Form } from '../../src/type/elysia/form'
import { IntegerString } from '../../src/type/elysia/integer-string'
import { Numeric } from '../../src/type/elysia/numeric'
import { NumericEnum } from '../../src/type/elysia/numeric-enum'
import { defaultWSParse } from '../../src/ws/parser'

describe('input coercion', () => {
	it('rejects empty numeric strings while accepting decimal strings', () => {
		expect(Value.Check(Numeric(), '')).toBe(false)
		expect(Value.Check(Numeric(), '   ')).toBe(false)
		expect(Value.Check(Numeric(), '5')).toBe(true)
		expect(Value.Check(IntegerString(), '')).toBe(false)
		expect(Value.Check(NumericEnum({ Zero: 0, One: 1 } as any), '')).toBe(
			false
		)
		expect(Value.Check(NumericEnum({ Zero: 0, One: 1 } as any), '0')).toBe(
			true
		)
	})

	it('decodes string booleans when schema options are present', () => {
		const schema = BooleanString({ default: false } as any)

		expect(Value.Check(schema, 'true')).toBe(true)
		expect(Value.Check(schema, 'false')).toBe(true)
		expect(Value.Decode(schema, 'true')).toBe(true)
		expect(Value.Check(schema, true)).toBe(true)
		expect(Value.Check(schema, 'nope')).toBe(false)
	})

	it('applies timestamp bounds to string dates including an epoch boundary', () => {
		const afterOneSecond = DateType({ minimumTimestamp: 1000 } as any)
		expect(Value.Check(afterOneSecond, '2024-06-01')).toBe(true)
		expect(Value.Check(afterOneSecond, '1969-01-01')).toBe(false)

		const afterEpoch = DateType({ minimumTimestamp: 0 } as any)
		expect(Value.Check(afterEpoch, '2024-06-01')).toBe(true)
	})

	it('rejects primitive form values without throwing', () => {
		expect(Value.Check(Form({} as any), null)).toBe(false)
		expect(Value.Check(Form({} as any), 'x')).toBe(false)
		expect(Value.Check(Form({} as any), 5)).toBe(false)
	})

	it('keeps digit strings that cannot be represented safely as numbers', () => {
		expect(defaultWSParse('12345678901234567890')).toBe(
			'12345678901234567890'
		)
		expect(defaultWSParse('5')).toBe(5)
		expect(defaultWSParse('123.45')).toBe(123.45)
	})
})
