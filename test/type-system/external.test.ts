import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'
import { Kind, TObject, TString, Type } from '@sinclair/typebox'

/**
 * Tests for t.External() helper which allows external TypeBox schemas
 * (e.g., from drizzle-typebox) to be used with Elysia's type system.
 *
 * @see https://github.com/elysiajs/elysia/issues/1688
 */
describe('t.External', () => {
	it('should accept external TypeBox schema', () => {
		// Simulate an external TypeBox schema (like from drizzle-typebox)
		// by creating a schema with the same structure but potentially
		// from a different module
		const externalSchema = Type.Object({
			id: Type.Number(),
			name: Type.String()
		})

		// t.External should wrap the external schema
		const wrappedSchema = t.External(externalSchema)

		// Verify the schema properties are preserved
		expect(wrappedSchema.type).toBe('object')
		expect(wrappedSchema.properties).toBeDefined()
		expect(wrappedSchema.properties!.id.type).toBe('number')
		expect(wrappedSchema.properties!.name.type).toBe('string')
	})

	it('should preserve static type inference', () => {
		const externalSchema = Type.Object({
			id: Type.Number(),
			name: Type.String()
		})

		const wrappedSchema = t.External(externalSchema)

		// Type inference should work
		type InferredType = typeof wrappedSchema.static
		const _typeCheck: InferredType = { id: 1, name: 'test' }

		expect(true).toBe(true)
	})

	it('should work with t.Array', () => {
		const externalSchema = Type.Object({
			id: Type.Number(),
			name: Type.String()
		})

		// This is the main use case from issue #1688
		const arraySchema = t.Array(t.External(externalSchema))

		expect(arraySchema.type).toBe('array')
		expect(arraySchema.items).toBeDefined()
	})

	it('should work in route response schema', async () => {
		const externalSchema = Type.Object({
			id: Type.Number(),
			name: Type.String()
		})

		const app = new Elysia().get('/users', () => [{ id: 1, name: 'test' }], {
			response: t.Array(t.External(externalSchema))
		})

		const response = await app.handle(new Request('http://localhost/users'))
		const data = await response.json()

		expect(response.status).toBe(200)
		expect(data).toEqual([{ id: 1, name: 'test' }])
	})

	it('should validate response correctly', async () => {
		const externalSchema = Type.Object({
			id: Type.Number(),
			name: Type.String()
		})

		const app = new Elysia().get(
			'/invalid',
			// Return invalid data
			() => [{ id: 'not-a-number', name: 123 }] as any,
			{
				response: t.Array(t.External(externalSchema))
			}
		)

		const response = await app.handle(new Request('http://localhost/invalid'))

		// Should fail validation
		expect(response.status).toBe(422)
	})

	it('should work with nested objects', () => {
		const addressSchema = Type.Object({
			street: Type.String(),
			city: Type.String()
		})

		const userSchema = Type.Object({
			id: Type.Number(),
			name: Type.String(),
			address: addressSchema
		})

		const wrappedSchema = t.External(userSchema)

		expect(wrappedSchema.type).toBe('object')
		expect(wrappedSchema.properties!.address).toBeDefined()
	})

	it('should work with schemas containing Kind symbol', () => {
		// Create a schema that has the Kind symbol (like real TypeBox schemas)
		const externalSchema: TObject<{ name: TString }> = {
			[Kind]: 'Object',
			type: 'object',
			properties: {
				name: {
					[Kind]: 'String',
					type: 'string',
					static: '',
					params: []
				} as TString
			},
			required: ['name'],
			static: { name: '' },
			params: []
		} as any

		// t.External should handle schemas with Kind symbol
		const wrappedSchema = t.External(externalSchema)

		expect(wrappedSchema.type).toBe('object')
	})
})
