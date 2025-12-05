import { t } from '../../src'
import { getSchemaValidator } from '../../src/schema'

import { describe, expect, it } from 'bun:test'

describe('Schema Validator', () => {
	describe('parse', () => {
		it('should parse valid object', () => {
			const validator = getSchemaValidator(
				t.Object({
					name: t.String()
				})
			)

			const result = validator.parse({ name: 'test' })

			expect(result).toEqual({ name: 'test' })
		})

		it('should pass object with additional properties when allowed', () => {
			const validator = getSchemaValidator(
				t.Object({
					a: t.String()
				}),
				{ additionalProperties: true }
			)

			const result = validator.parse({
				a: 'hello',
				b: 'world'
			})

			expect(result.a).toBe('hello')
		})

		it('should reject additional properties by default', () => {
			const validator = getSchemaValidator(
				t.Object({
					a: t.String()
				})
			)

			expect(() =>
				validator.parse({
					a: 'hello',
					b: 'world'
				})
			).toThrow()
		})

		it('should throw on invalid data', () => {
			const validator = getSchemaValidator(
				t.Object({
					name: t.String()
				})
			)

			expect(() => validator.parse({ name: 123 })).toThrow()
		})
	})

	describe('safeParse', () => {
		it('should return success with data on valid input', () => {
			const validator = getSchemaValidator(
				t.Object({
					a: t.String()
				})
			)

			const result = validator.safeParse({ a: 'test' })

			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data).toEqual({ a: 'test' })
				expect(result.error).toBeNull()
			}
		})

		it('should return failure with error on invalid input', () => {
			const validator = getSchemaValidator(
				t.Object({
					a: t.String()
				})
			)

			const result = validator.safeParse({ a: 123 })

			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.data).toBeNull()
				expect(result.error).toBeDefined()
				expect(result.errors).toBeDefined()
			}
		})

		it('should work with union types', () => {
      // Sample union schema
      const eventPayload = t.Union([
        t.Object({
          type: t.Literal('message'),
          content: t.String()
        }),
        t.Object({
          type: t.Literal('error'),
          code: t.Number()
        })
      ])
      type eventPayload = typeof eventPayload.static

			const validator = getSchemaValidator(eventPayload)

			// Test message type
			const messageResult = validator.safeParse({
				type: 'message',
				content: 'hello'
			})

			expect(messageResult.success).toBe(true)
			if (messageResult.success) {
				expect(messageResult.data).toEqual({
					type: 'message',
					content: 'hello'
				})
			}

			// Test error type
			const errorResult = validator.safeParse({
				type: 'error',
				code: 500
			})

			expect(errorResult.success).toBe(true)
			if (errorResult.success) {
				expect(errorResult.data).toEqual({
					type: 'error',
					code: 500
				})
			}

			// Test invalid type
			const invalidResult = validator.safeParse({
				type: 'unknown'
			})

			expect(invalidResult.success).toBe(false)
		})

		it('should have correct type inference for data', () => {
			const validator = getSchemaValidator(
				t.Object({
					id: t.Number(),
					name: t.String()
				})
			)

			const result = validator.safeParse({ id: 1, name: 'test' })

			if (result.success) {
				const id: number = result.data.id
				const name: string = result.data.name

				expect(id).toBe(1)
				expect(name).toBe('test')
			}
		})
	})
})
