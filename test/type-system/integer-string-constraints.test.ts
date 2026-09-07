import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'

describe('TypeSystem - IntegerString constraints', () => {
	it('accepts a value at minimum and rejects below it', () => {
		const schema = t.IntegerString({ minimum: 0 })

		expect(Value.Check(schema, '0')).toBe(true)
		expect(Value.Check(schema, '-1')).toBe(false)
	})

	it('accepts a value at maximum and rejects above it', () => {
		const schema = t.IntegerString({ maximum: 10 })

		expect(Value.Check(schema, '10')).toBe(true)
		expect(Value.Check(schema, '11')).toBe(false)
	})

	it('excludes the exact exclusiveMinimum bound', () => {
		const schema = t.IntegerString({ exclusiveMinimum: 0 })

		expect(Value.Check(schema, '0')).toBe(false)
		expect(Value.Check(schema, '1')).toBe(true)
	})

	it('excludes the exact exclusiveMaximum bound', () => {
		const schema = t.IntegerString({ exclusiveMaximum: 10 })

		expect(Value.Check(schema, '10')).toBe(false)
		expect(Value.Check(schema, '9')).toBe(true)
	})

	it('accepts multiples and rejects non-multiples', () => {
		const schema = t.IntegerString({ multipleOf: 2 })

		expect(Value.Check(schema, '4')).toBe(true)
		expect(Value.Check(schema, '3')).toBe(false)
	})

	it('rejects non-decimal strings regardless of constraints', () => {
		const schema = t.IntegerString({ minimum: 0, maximum: 100 })

		expect(Value.Check(schema, '1.5')).toBe(false)
		expect(Value.Check(schema, '1e3')).toBe(false)
		expect(Value.Check(schema, 'abc')).toBe(false)
		expect(Value.Check(schema, '0x10')).toBe(false)
		expect(Value.Check(schema, ' 1')).toBe(false)
	})

	it('accepts a leading-sign decimal string within range', () => {
		const schema = t.IntegerString({ minimum: 0, maximum: 100 })

		expect(Value.Check(schema, '+1')).toBe(true)
	})

	it('decodes a matching constrained string to a number', () => {
		const schema = t.IntegerString({
			minimum: 0,
			maximum: 10,
			multipleOf: 2
		})

		expect(Value.Decode(schema, '4')).toBe(4)
	})

	it('combines every constraint on the same schema', () => {
		const schema = t.IntegerString({
			minimum: 0,
			maximum: 10,
			multipleOf: 2
		})

		expect(Value.Check(schema, '4')).toBe(true)
		// odd: fails multipleOf
		expect(Value.Check(schema, '3')).toBe(false)
		// above maximum
		expect(Value.Check(schema, '12')).toBe(false)
		// below minimum
		expect(Value.Check(schema, '-2')).toBe(false)
	})

	it('applies the same constraints to plain (already-decoded) integers', () => {
		const schema = t.IntegerString({
			minimum: 0,
			maximum: 10,
			multipleOf: 2
		})

		expect(Value.Check(schema, 4)).toBe(true)
		expect(Value.Check(schema, 11)).toBe(false)
	})

	it('decodes a constrained t.Integer query value and rejects out-of-range or malformed input', async () => {
		const app = new Elysia().get(
			'/',
			{
				query: t.Object({
					n: t.Integer({ minimum: 0, maximum: 10, multipleOf: 2 })
				})
			},
			({ query }) => query.n
		)

		const ok = await app.handle('/?n=4')
		expect(ok.status).toBe(200)
		await expect(ok.text()).resolves.toBe('4')

		const oddRejected = await app.handle('/?n=3')
		expect(oddRejected.status).toBe(422)

		const overMax = await app.handle('/?n=11')
		expect(overMax.status).toBe(422)

		const underMin = await app.handle('/?n=-2')
		expect(underMin.status).toBe(422)

		const decimal = await app.handle('/?n=1.5')
		expect(decimal.status).toBe(422)

		const hex = await app.handle('/?n=0x2')
		expect(hex.status).toBe(422)
	})

	it('decodes a constrained t.Integer route param and rejects a value outside the bound', async () => {
		const app = new Elysia().get(
			'/:id',
			{
				params: t.Object({
					id: t.Integer({ exclusiveMinimum: 0, exclusiveMaximum: 5 })
				})
			},
			({ params }) => params.id
		)

		const ok = await app.handle('/3')
		expect(ok.status).toBe(200)
		await expect(ok.text()).resolves.toBe('3')

		const atLowerBound = await app.handle('/0')
		expect(atLowerBound.status).toBe(422)

		const atUpperBound = await app.handle('/5')
		expect(atUpperBound.status).toBe(422)
	})
})
