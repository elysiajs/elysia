import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value, EncodeError, DecodeError } from 'typebox/value'

describe('TypeSystem - ArrayBuffer', () => {
	it('Create', () => {
		expect(Value.Create(t.ArrayBuffer())).toBeUndefined()

		expect(
			Value.Create(
				t.ArrayString(t.Any(), {
					default: '[]'
				})
			)
		).toBe('[]')
	})

	it('Check', () => {
		const schema = t.ArrayBuffer()

		expect(Value.Check(schema, new ArrayBuffer())).toBe(true)
		expect(Value.Check(schema, [1, 2, 3])).toBe(false)
	})

	it('Encode', () => {
		const schema = t.ArrayBuffer()

		expect(() => Value.Encode(schema, [1, 2, 3])).toThrow(EncodeError)
		expect(() => Value.Encode(schema, 'test')).toThrow(EncodeError)
		expect(() => Value.Encode(schema, 123)).toThrow(EncodeError)
		expect(() => Value.Encode(schema, true)).toThrow(EncodeError)
		expect(() => Value.Encode(schema, null)).toThrow(EncodeError)
		expect(() => Value.Encode(schema, undefined)).toThrow(EncodeError)
	})

	it('Decode', () => {
		const schema = t.ArrayBuffer()

		expect(Value.Decode(schema, new ArrayBuffer())).toEqual(
			new ArrayBuffer()
		)
		expect(() => Value.Decode(schema, [1, 2, 3])).toThrow(DecodeError)
		expect(() => Value.Decode(schema, 'test')).toThrow(DecodeError)
		expect(() => Value.Decode(schema, 123)).toThrow(DecodeError)
		expect(() => Value.Decode(schema, true)).toThrow(DecodeError)
		expect(() => Value.Decode(schema, null)).toThrow(DecodeError)
		expect(() => Value.Decode(schema, undefined)).toThrow(DecodeError)
	})

	it('Integrate', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.ArrayBuffer(),
				response: t.ArrayBuffer()
			},
			({ body }) => body
		)

		const response = await app.handle(
			new Request('http://localhost', {
				method: 'POST',
				body: new TextEncoder().encode('可愛くてごめん'),
				headers: { 'content-type': 'application/octet-stream' }
			})
		)

		await expect(response.text()).resolves.toBe('可愛くてごめん')
	})
})
