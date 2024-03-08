import { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { TBoolean, TDate, TypeBoxError } from '@sinclair/typebox'

describe('TypeSystem - Date', () => {
	it('Create', () => {
		expect(Value.Create(t.Date())).toBeInstanceOf(Date)
	})

	it('Check', () => {
		const schema = t.Date()

		expect(Value.Check(schema, new Date())).toEqual(true)
		expect(Value.Check(schema, '2021/1/1')).toEqual(true)

		expect(Value.Check(schema, 'yay')).toEqual(false)
		expect(Value.Check(schema, 42)).toEqual(false)
		expect(Value.Check(schema, {})).toEqual(false)
		expect(Value.Check(schema, undefined)).toEqual(false)
		expect(Value.Check(schema, null)).toEqual(false)
	})

	it('Encode', () => {
		const schema = t.Date()

		expect(Value.Encode<TDate, Date>(schema, new Date())).toEqual(
			new Date()
		)
		expect(Value.Encode<TDate, Date>(schema, '2021/1/1')).toEqual(
			new Date('2021/1/1')
		)

		const error = new TypeBoxError('Unable to encode due to invalid value')
		expect(() => Value.Encode(schema, 'yay')).toThrow(error)
		expect(() => Value.Encode(schema, 42)).toThrow(error)
		expect(() => Value.Encode(schema, {})).toThrow(error)
		expect(() => Value.Encode(schema, undefined)).toThrow(error)
		expect(() => Value.Encode(schema, null)).toThrow(error)
	})

	it('Decode', () => {
		const schema = t.Date()

		expect(Value.Decode<TDate, Date>(schema, new Date())).toEqual(
			new Date()
		)
		expect(Value.Decode<TDate, Date>(schema, '2021/1/1')).toEqual(
			new Date('2021/1/1')
		)

		const error = new TypeBoxError('Unable to decode due to invalid value')
		expect(() => Value.Decode(schema, 'yay')).toThrow(error)
		expect(() => Value.Decode(schema, 42)).toThrow(error)
		expect(() => Value.Decode(schema, {})).toThrow(error)
		expect(() => Value.Decode(schema, undefined)).toThrow(error)
		expect(() => Value.Decode(schema, null)).toThrow(error)
	})
})
