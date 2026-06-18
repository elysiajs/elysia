import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'
import { req } from '../utils'

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
		// BooleanString is a decode-only codec (string -> boolean). As of
		// TypeBox 1.2.16 the union is matched narrow->broad, so encoding a
		// boolean resolves through the plain Boolean member and passes through
		// unchanged instead of throwing.
		const schema = t.BooleanString()

		expect(Value.Encode(schema, true)).toBe(true)
		expect(Value.Encode(schema, false)).toBe(false)
	})

	it('Decode', () => {
		const schema = t.BooleanString()

		expect(Value.Decode(schema, true)).toBe(true)
		expect(Value.Decode(schema, 'true')).toBe(true)

		expect(Value.Decode(schema, false)).toBe(false)
		expect(Value.Decode(schema, 'false')).toBe(false)

		// Rejection of invalid values is covered by the Check test;
		// `Value.Decode` runs Convert before its Check gate and is lenient.
	})

	it('Integrate', async () => {
		const app = new Elysia().get(
			'/',
			{
				query: t.Object({
					value: t.BooleanString()
				})
			},
			({ query }) => query
		)

		const res1 = await app.handle(req('/?value=true'))
		expect(res1.status).toBe(200)

		const res2 = await app.handle(req('/?value=false'))
		expect(res2.status).toBe(200)

		const res3 = await app.handle(req('/?value=aight'))
		expect(res3.status).toBe(422)
	})
})
