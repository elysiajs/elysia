import { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { TBoolean, TypeBoxError } from '@sinclair/typebox'

describe('TypeSystem - BooleanString', () => {
	it('Create', () => {
		expect(Value.Create(t.BooleanString())).toBe(false)
		expect(Value.Create(t.BooleanString({ default: true }))).toBe(true)
	})

	it('Check', () => {
		const schema = t.BooleanString()

		expect(Value.Check(schema, true)).toBe(true)
		expect(Value.Check(schema, 'true')).toBe(true)
		expect(Value.Check(schema, false)).toBe(true)
		expect(Value.Check(schema, 'false')).toBe(true)

		expect(Value.Check(schema, 'yay')).toBe(false)
		expect(Value.Check(schema, 42)).toBe(false)
		expect(Value.Check(schema, {})).toBe(false)
		expect(Value.Check(schema, undefined)).toBe(false)
		expect(Value.Check(schema, null)).toBe(false)
	})

	it('Encode', () => {
		const schema = t.BooleanString()

		expect(Value.Encode<TBoolean, boolean>(schema, true)).toBe(true)
		expect(Value.Encode<TBoolean, string>(schema, 'true')).toBe('true')

		expect(Value.Encode<TBoolean, boolean>(schema, false)).toBe(false)
		expect(Value.Encode<TBoolean, string>(schema, 'false')).toBe('false')

		const error = new TypeBoxError('Unable to encode due to invalid value')
		expect(() => Value.Encode(schema, 'yay')).toThrow(error)
		expect(() => Value.Encode(schema, 42)).toThrow(error)
		expect(() => Value.Encode(schema, {})).toThrow(error)
		expect(() => Value.Encode(schema, undefined)).toThrow(error)
		expect(() => Value.Encode(schema, null)).toThrow(error)
	})

	it('Decode', () => {
		const schema = t.BooleanString()

		expect(Value.Decode<TBoolean, boolean>(schema, true)).toBe(true)
		expect(Value.Decode<TBoolean, boolean>(schema, 'true')).toBe(true)

		expect(Value.Decode<TBoolean, boolean>(schema, false)).toBe(false)
		expect(Value.Decode<TBoolean, boolean>(schema, 'false')).toBe(false)

		const error = new TypeBoxError('Unable to decode due to invalid value')
		expect(() => Value.Decode(schema, 'yay')).toThrow(error)
		expect(() => Value.Decode(schema, 42)).toThrow(error)
		expect(() => Value.Decode(schema, {})).toThrow(error)
		expect(() => Value.Decode(schema, undefined)).toThrow(error)
		expect(() => Value.Decode(schema, null)).toThrow(error)
	})
})
