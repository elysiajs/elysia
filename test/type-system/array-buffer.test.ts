import Elysia, { t } from '../../src'
import { applySchemaDefaults } from '../../src/schema'
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

	describe.each([true, false])('preserve input (aot: %s)', (aot) => {
		it('at the request body root', async () => {
			const buffer = new ArrayBuffer(4)
			new Uint8Array(buffer).set([1, 2, 3, 4])
			const read = (value: ArrayBuffer) =>
				Array.from(new Uint8Array(value)).join(',')
			const app = new Elysia({ aot }).post('/', ({ body }) => read(body), {
				parse: () => buffer,
				body: t.ArrayBuffer()
			})

			const response = await app.handle(
				new Request('http://localhost/', {
					method: 'POST',
					headers: { 'content-type': 'custom' },
					body: 'body'
				})
			)

			expect(await response.text()).toBe('1,2,3,4')
		})
	})

	it('preserves nested object and array values while applying defaults', () => {
		const buffer = new ArrayBuffer(4)
		new Uint8Array(buffer).set([1, 2, 3, 4])

		const object = applySchemaDefaults(
			{ schema: t.Object({ value: t.ArrayBuffer() }) } as any,
			{ value: buffer }
		) as { value: ArrayBuffer }
		const array = applySchemaDefaults(
			{ schema: t.Array(t.ArrayBuffer()) } as any,
			[buffer]
		) as ArrayBuffer[]

		expect(Array.from(new Uint8Array(object.value))).toEqual([1, 2, 3, 4])
		expect(Array.from(new Uint8Array(array[0]))).toEqual([1, 2, 3, 4])
	})
})
