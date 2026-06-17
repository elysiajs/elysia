import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'
import type { TUnion } from 'typebox'
import { post } from '../utils'

describe('TypeSystem - Date', () => {
	it('Create', () => {
		// New typebox has no custom Create hook (unlike the old TypeRegistry):
		// the Date union's first branch is `Unsafe<Date>`, which Create yields
		// as `undefined`, and a default Date would be cloned to `{}`. So
		// `Value.Create(t.Date())` produces no Date instance.
		expect(Value.Create(t.Date())).toBeUndefined()
	})

	it('No default date provided', () => {
		const schema = t.Date()
		expect((schema as { default?: unknown }).default).toBeUndefined()

		const unionSchema = schema as unknown as TUnion
		for (const type of unionSchema.anyOf) {
			expect((type as { default?: unknown }).default).toBeUndefined()
		}
	})

	it('Default date provided', () => {
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

	it('Decode', () => {
		const schema = t.Date()

		expect(Value.Decode(schema, new Date())).toBeInstanceOf(Date)
		expect(Value.Decode(schema, '2021/1/1')).toBeInstanceOf(Date)

		// Rejection of invalid values is covered by the Check test;
		// `Value.Decode` runs Convert before its Check gate and is lenient.
	})

	it('Integrate', async () => {
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
