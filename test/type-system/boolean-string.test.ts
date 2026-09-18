import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'

describe('TypeSystem - BooleanString', () => {
	it('creates false by default and honors an explicit default', () => {
		expect(Value.Create(t.BooleanString())).toBe(false)
		expect(Value.Create(t.BooleanString({ default: true }))).toBe(true)
	})

	it('accepts booleans and boolean strings only', () => {
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

	it('preserves booleans during encoding', () => {
		const schema = t.BooleanString()

		expect(Value.Encode(schema, true)).toBe(true)
		expect(Value.Encode(schema, false)).toBe(false)
	})

	it('decodes boolean strings', () => {
		const schema = t.BooleanString()

		expect(Value.Decode(schema, true)).toBe(true)
		expect(Value.Decode(schema, 'true')).toBe(true)

		expect(Value.Decode(schema, false)).toBe(false)
		expect(Value.Decode(schema, 'false')).toBe(false)
	})

	it('decodes valid query values and rejects other strings', async () => {
		const app = new Elysia().get(
			'/',
			{
				query: t.Object({
					value: t.BooleanString()
				})
			},
			({ query }) => query
		)

		const res1 = await app.handle('/?value=true')
		expect(res1.status).toBe(200)

		const res2 = await app.handle('/?value=false')
		expect(res2.status).toBe(200)

		const res3 = await app.handle('/?value=aight')
		expect(res3.status).toBe(422)
	})
})
