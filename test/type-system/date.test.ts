import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { TBoolean, TDate, TUnion, TypeBoxError } from '@sinclair/typebox'
import { post } from '../utils'

describe('TypeSystem - Date', () => {
	it('Create', () => {
		expect(Value.Create(t.Date())).toBeInstanceOf(Date)
	})

	it('No default date provided', () => {
		const schema = t.Date()
		expect(schema.default).toBeUndefined()

		const unionSchema = schema as unknown as TUnion
		for (const type of unionSchema.anyOf) {
			expect(type.default).toBeUndefined()
		}
	})

	it('Default date provided', () => {
		const given = new Date('2025-01-01T00:00:00.000Z')
		const schema = t.Date({ default: given })
		expect(schema.default).toEqual(given)

		const unionSchema = schema as unknown as TUnion
		for (const type of unionSchema.anyOf) {
			expect(new Date(type.default)).toEqual(given)
		}
	})

	it('Check', () => {
		const schema = t.Date()

		expect(Value.Check(schema, new Date())).toEqual(true)
		expect(Value.Check(schema, '2021/1/1')).toEqual(true)

		expect(Value.Check(schema, 'yay')).toEqual(false)
		expect(Value.Check(schema, 42)).toEqual(true)
		expect(Value.Check(schema, {})).toEqual(false)
		expect(Value.Check(schema, undefined)).toEqual(false)
		expect(Value.Check(schema, null)).toEqual(false)
	})

	it('Encode', () => {
		const schema = t.Date()

		const date = new Date()

		expect(Value.Encode<TDate, string>(schema, date)).toBe(
			date.toISOString()
		)

		expect(() => Value.Encode(schema, 'yay')).toThrowError()
		expect(() =>
			Value.Encode(schema, Value.Decode(schema, 42))
		).not.toThrowError()
		expect(() => new Date().toISOString()).not.toThrowError()
		expect(() => Value.Encode(schema, {})).toThrowError()
		expect(() => Value.Encode(schema, undefined)).toThrowError()
		expect(() => Value.Encode(schema, null)).toThrowError()
	})

	it('Decode', () => {
		const schema = t.Date()

		expect(Value.Decode<TDate, Date>(schema, new Date())).toBeInstanceOf(
			Date
		)
		expect(Value.Decode<TDate, Date>(schema, '2021/1/1')).toBeInstanceOf(
			Date
		)

		const error = new TypeBoxError(
			'Unable to decode value as it does not match the expected schema'
		)
		expect(() => Value.Decode(schema, 'yay')).toThrow(error)
		expect(() => Value.Decode(schema, 42)).not.toThrow(error)
		expect(() => Value.Decode(schema, {})).toThrow(error)
		expect(() => Value.Decode(schema, undefined)).toThrow(error)
		expect(() => Value.Decode(schema, null)).toThrow(error)
	})

	it('Integrate', async () => {
		const app = new Elysia().post('/', ({ body: { date } }) => date, {
			body: t.Object({
				date: t.Date()
			})
		})

		const res1 = await app.handle(
			post('/', {
				date: new Date()
			})
		)
		expect(res1.status).toBe(200)

		const res2 = await app.handle(
			post('/', {
				date: '2021/1/1'
			})
		)
		expect(res2.status).toBe(200)

		const res3 = await app.handle(
			post('/', {
				date: 'Skibidi dom dom yes yes'
			})
		)
		expect(res3.status).toBe(422)
	})
})
