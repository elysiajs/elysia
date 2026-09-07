import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'
import type { TUnion } from 'typebox'
import { post, json } from '../utils'

describe('TypeSystem - Date', () => {
	it('does not synthesize a Date without a default', () => {
		expect(Value.Create(t.Date())).toBeUndefined()
	})

	it('omits default metadata when no date default is provided', () => {
		const schema = t.Date()
		expect((schema as { default?: unknown }).default).toBeUndefined()

		const unionSchema = schema as unknown as TUnion
		for (const type of unionSchema.anyOf) {
			expect((type as { default?: unknown }).default).toBeUndefined()
		}
	})

	it('copies an explicit default to every union member', () => {
		const given = new Date('2025-01-01T00:00:00.000Z')
		const schema = t.Date({ default: given })
		expect((schema as { default?: unknown }).default).toEqual(given)

		const unionSchema = schema as unknown as TUnion
		for (const type of unionSchema.anyOf) {
			expect(new Date((type as { default: string }).default)).toEqual(
				given
			)
		}
	})

	it('accepts Date instances and coercible date values', () => {
		const schema = t.Date()

		expect(Value.Check(schema, new Date())).toEqual(true)
		expect(Value.Check(schema, '2021/1/1')).toEqual(true)

		expect(Value.Check(schema, 'yay')).toEqual(false)
		expect(Value.Check(schema, 42)).toEqual(true)
		expect(Value.Check(schema, {})).toEqual(false)
		expect(Value.Check(schema, undefined)).toEqual(false)
		expect(Value.Check(schema, null)).toEqual(false)
	})

	it('encodes valid dates as ISO strings', () => {
		const schema = t.Date()

		const date = new Date()

		expect(Value.Encode(schema, date)).toBe(date.toISOString())

		expect(() => Value.Encode(schema, 'yay')).toThrowError()
		expect(() =>
			Value.Encode(schema, Value.Decode(schema, 42))
		).not.toThrowError()
		expect(() => new Date().toISOString()).not.toThrowError()
		expect(() => Value.Encode(schema, {})).toThrowError()
		expect(() => Value.Encode(schema, undefined)).toThrowError()
		expect(() => Value.Encode(schema, null)).toThrowError()
	})

	it('decodes Date instances and date strings to Date', () => {
		const schema = t.Date()

		expect(Value.Decode(schema, new Date())).toBeInstanceOf(Date)
		expect(Value.Decode(schema, '2021/1/1')).toBeInstanceOf(Date)
	})

	it('decodes valid request dates and rejects invalid strings', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					date: t.Date()
				})
			},
			({ body: { date } }) => date
		)

		const res1 = await app.handle(
			'/',
			json({
				date: new Date()
			})
		)
		expect(res1.status).toBe(200)

		const res2 = await app.handle(
			'/',
			json({
				date: '2021/1/1'
			})
		)
		expect(res2.status).toBe(200)

		const res3 = await app.handle(
			'/',
			json({
				date: 'Skibidi dom dom yes yes'
			})
		)
		expect(res3.status).toBe(422)
	})
})
