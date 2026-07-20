import { describe, expect, it } from 'bun:test'
import { Convert, DecodeUnsafe, EncodeUnsafe } from 'typebox/value'

import { t } from '../../src'
import {
	createDecodePlan,
	createEncodePlan
} from '../../src/type/validator/codec-plan'
import { createConvertPlan } from '../../src/type/validator/convert-plan'

const codedNumber = () =>
	t
		.Codec(t.String())
		.Decode((value) => Number(value))
		.Encode((value) => String(value))

describe('detached codec operation parity', () => {
	it('matches inherited-safe and dangerous-own object traversal', () => {
		const properties = Object.defineProperty(
			{ value: codedNumber() },
			'__proto__',
			{
				value: codedNumber(),
				enumerable: true
			}
		)
		const schema = t.Object(properties as any)
		const inherited = { value: '2' }
		const oracle = Object.create(inherited)
		const candidate = Object.create(inherited)

		const expected = DecodeUnsafe({}, schema, oracle) as any
		const actual = createDecodePlan(schema)(candidate) as any

		expect(actual.value).toBe(expected.value)
		expect(Object.hasOwn(actual, 'value')).toBe(
			Object.hasOwn(expected, 'value')
		)
		expect(Object.hasOwn(actual, '__proto__')).toBe(false)
		expect(Object.hasOwn(expected, '__proto__')).toBe(false)
	})

	it('matches TypeBox intersection handling for arrays', () => {
		const codec = t
			.Codec(t.Array(t.Number()))
			.Decode((value) => value.map((entry) => entry + 1))
			.Encode((value) => value.map((entry) => entry - 1))
		const schema = t.Intersect([codec, t.Array(t.Number())])

		expect(createDecodePlan(schema)([1, 2])).toEqual(
			DecodeUnsafe({}, schema, [1, 2])
		)
		expect(createEncodePlan(schema)([2, 3])).toEqual(
			EncodeUnsafe({}, schema, [2, 3])
		)
	})

	it('matches optional-undefined traversal in both directions', () => {
		const schema = t.Object({ value: t.Optional(codedNumber()) })

		expect(createDecodePlan(schema)({ value: undefined })).toEqual(
			DecodeUnsafe({}, schema, { value: undefined })
		)
		expect(createEncodePlan(schema)({ value: undefined })).toEqual(
			EncodeUnsafe({}, schema, { value: undefined })
		)
	})

	it('matches conversion across primitive and structural nodes', () => {
		const schema = t.Object({
			number: t.Number(),
			integer: t.Integer(),
			boolean: t.Boolean(),
			string: t.String(),
			array: t.Array(t.Number()),
			union: t.Union([t.Number(), t.Boolean()])
		})
		const input = {
			number: '2',
			integer: '3.8',
			boolean: 'true',
			string: 4,
			array: '5',
			union: 'false'
		}

		expect(createConvertPlan(schema)(structuredClone(input))).toEqual(
			Convert(schema, structuredClone(input))
		)
	})
})
