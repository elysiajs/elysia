import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { TypeBoxError } from '@sinclair/typebox'

describe('TypeSystem - ArrayBuffer', () => {
	it('Create', () => {
		// @ts-expect-error
		expect(Value.Create(t.ArrayBuffer())).toEqual([1, 2, 3])

		expect(
			Value.Create(
				t.ArrayString(t.Any(), {
					default: '[]'
				})
			)
			// @ts-expect-error
		).toBe('[]')
	})

	it('Check', () => {
		const schema = t.ArrayBuffer()

		expect(Value.Check(schema, new ArrayBuffer())).toBe(true)
		expect(Value.Check(schema, [1, 2, 3])).toBe(false)
	})

	it('Encode', () => {
		const schema = t.ArrayBuffer()

		expect(() => Value.Encode(schema, [1, 2, 3])).toThrow(TypeBoxError)
		expect(() => Value.Encode(schema, 'test')).toThrow(TypeBoxError)
		expect(() => Value.Encode(schema, 123)).toThrow(TypeBoxError)
		expect(() => Value.Encode(schema, true)).toThrow(TypeBoxError)
		expect(() => Value.Encode(schema, null)).toThrow(TypeBoxError)
		expect(() => Value.Encode(schema, undefined)).toThrow(TypeBoxError)
	})

	it('Decode', () => {
		const schema = t.ArrayBuffer()

		expect(Value.Decode(schema, new ArrayBuffer())).toEqual(
			new ArrayBuffer()
		)
		expect(() => Value.Decode(schema, [1, 2, 3])).toThrow(TypeBoxError)
		expect(() => Value.Decode(schema, 'test')).toThrow(TypeBoxError)
		expect(() => Value.Decode(schema, 123)).toThrow(TypeBoxError)
		expect(() => Value.Decode(schema, true)).toThrow(TypeBoxError)
		expect(() => Value.Decode(schema, null)).toThrow(TypeBoxError)
		expect(() => Value.Decode(schema, undefined)).toThrow(TypeBoxError)
	})

	it('Integrate', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.ArrayBuffer(),
			response: t.ArrayBuffer()
		})

		const response = await app.handle(
			new Request('http://localhost', {
				method: 'POST',
				body: new TextEncoder().encode('可愛くてごめん'),
				headers: { 'content-type': 'application/octet-stream' }
			})
		)

		expect(await response.text()).toBe('可愛くてごめん')
	})
})
