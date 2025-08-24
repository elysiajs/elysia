import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { TypeBoxError } from '@sinclair/typebox'

describe('TypeSystem - Uint8Array', () => {
	// it('Create', () => {
	// 	// @ts-expect-error
	// 	expect(Value.Create(t.Uint8Array())).toEqual([1, 2, 3])

	// 	expect(
	// 		Value.Create(
	// 			t.ArrayString(t.Any(), {
	// 				default: '[]'
	// 			})
	// 		)
	// 		// @ts-expect-error
	// 	).toBe('[]')
	// })

	// it('Check', () => {
	// 	const schema = t.Uint8Array()

	// 	expect(Value.Check(schema, new ArrayBuffer())).toBe(true)
	// 	expect(Value.Check(schema, new TextEncoder().encode('hello!'))).toBe(
	// 		true
	// 	)
	// 	expect(Value.Check(schema, [1, 2, 3])).toBe(false)

	// 	expect(
	// 		Value.Check(
	// 			t.Uint8Array({
	// 				maxByteLength: 2
	// 			}),
	// 			new TextEncoder().encode('hello!')
	// 		)
	// 	).toBe(false)
	// })

	// it('Encode', () => {
	// 	const schema = t.Uint8Array()

	// 	expect(() => Value.Encode(schema, [1, 2, 3])).toThrow(TypeBoxError)
	// 	expect(() => Value.Encode(schema, 'test')).toThrow(TypeBoxError)
	// 	expect(() => Value.Encode(schema, 123)).toThrow(TypeBoxError)
	// 	expect(() => Value.Encode(schema, true)).toThrow(TypeBoxError)
	// 	expect(() => Value.Encode(schema, null)).toThrow(TypeBoxError)
	// 	expect(() => Value.Encode(schema, undefined)).toThrow(TypeBoxError)
	// })

	// it('Decode', () => {
	// 	const schema = t.Uint8Array()

	// 	expect(Value.Decode(schema, new ArrayBuffer())).toEqual(
	// 		new Uint8Array()
	// 	)
	// 	expect(() => Value.Decode(schema, [1, 2, 3])).toThrow(TypeBoxError)
	// 	expect(() => Value.Decode(schema, 'test')).toThrow(TypeBoxError)
	// 	expect(() => Value.Decode(schema, 123)).toThrow(TypeBoxError)
	// 	expect(() => Value.Decode(schema, true)).toThrow(TypeBoxError)
	// 	expect(() => Value.Decode(schema, null)).toThrow(TypeBoxError)
	// 	expect(() => Value.Decode(schema, undefined)).toThrow(TypeBoxError)
	// })

	it('Integrate', async () => {
		const app = new Elysia().post('/', ({ body }) => {
			console.log(body)

			return body
		}, {
			body: t.Uint8Array(),
			response: t.Uint8Array()
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
