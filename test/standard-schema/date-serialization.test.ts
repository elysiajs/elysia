import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'
import { serializeDates } from '../../src/schema'

/**
 * Tests for Date serialization in Standard Schema validators.
 * 
 * When using Standard Schema validators (Zod, Effect, etc.) with dates,
 * Elysia should automatically serialize Date objects to ISO strings
 * before response validation, matching JSON.stringify behavior.
 *
 * @see https://github.com/elysiajs/elysia/issues/1670
 */
describe('Date Serialization', () => {
	describe('serializeDates helper', () => {
		it('should convert Date to ISO string', () => {
			const date = new Date('2026-01-20T12:00:00.000Z')
			expect(serializeDates(date)).toBe('2026-01-20T12:00:00.000Z')
		})

		it('should handle null and undefined', () => {
			expect(serializeDates(null)).toBe(null)
			expect(serializeDates(undefined)).toBe(undefined)
		})

		it('should pass through primitives unchanged', () => {
			expect(serializeDates('hello')).toBe('hello')
			expect(serializeDates(42)).toBe(42)
			expect(serializeDates(true)).toBe(true)
		})

		it('should serialize nested Date in object', () => {
			const date = new Date('2026-01-20T12:00:00.000Z')
			const result = serializeDates({
				name: 'test',
				createdAt: date
			})
			expect(result).toEqual({
				name: 'test',
				createdAt: '2026-01-20T12:00:00.000Z'
			})
		})

		it('should serialize Date in array', () => {
			const date = new Date('2026-01-20T12:00:00.000Z')
			const result = serializeDates([date, 'other'])
			expect(result).toEqual(['2026-01-20T12:00:00.000Z', 'other'])
		})

		it('should handle deeply nested objects with dates', () => {
			const date = new Date('2026-01-20T12:00:00.000Z')
			const result = serializeDates({
				user: {
					name: 'Alice',
					profile: {
						createdAt: date,
						updatedAt: date
					}
				},
				timestamps: [date, date]
			})
			expect(result).toEqual({
				user: {
					name: 'Alice',
					profile: {
						createdAt: '2026-01-20T12:00:00.000Z',
						updatedAt: '2026-01-20T12:00:00.000Z'
					}
				},
				timestamps: [
					'2026-01-20T12:00:00.000Z',
					'2026-01-20T12:00:00.000Z'
				]
			})
		})

		it('should return null for invalid Date (matching JSON.stringify)', () => {
			const invalidDate = new Date('invalid')
			expect(serializeDates(invalidDate)).toBe(null)
			// Verify it matches JSON.stringify behavior
			expect(JSON.parse(JSON.stringify(invalidDate))).toBe(null)
		})

		it('should return null for invalid Date in nested object', () => {
			const invalidDate = new Date('not-a-date')
			const result = serializeDates({
				name: 'test',
				createdAt: invalidDate
			})
			expect(result).toEqual({
				name: 'test',
				createdAt: null
			})
		})

		it('should return null for invalid Date in array', () => {
			const invalidDate = new Date('invalid')
			const validDate = new Date('2026-01-20T12:00:00.000Z')
			const result = serializeDates([invalidDate, validDate])
			expect(result).toEqual([null, '2026-01-20T12:00:00.000Z'])
		})

		it('should call toJSON method on objects (matching JSON.stringify)', () => {
			const customObj = {
				value: 42,
				toJSON() {
					return { serialized: this.value }
				}
			}
			const result = serializeDates(customObj)
			expect(result).toEqual({ serialized: 42 })
			// Verify it matches JSON.stringify behavior
			expect(result).toEqual(JSON.parse(JSON.stringify(customObj)))
		})

		it('should handle nested toJSON with Date inside', () => {
			const date = new Date('2026-01-20T12:00:00.000Z')
			const customObj = {
				toJSON() {
					return { timestamp: date }
				}
			}
			const result = serializeDates(customObj)
			expect(result).toEqual({ timestamp: '2026-01-20T12:00:00.000Z' })
		})

		it('should handle toJSON returning primitive', () => {
			const customObj = {
				toJSON() {
					return 'custom-string'
				}
			}
			const result = serializeDates(customObj)
			expect(result).toBe('custom-string')
		})

		it('should handle toJSON returning array with dates', () => {
			const date = new Date('2026-01-20T12:00:00.000Z')
			const customObj = {
				toJSON() {
					return [date, 'other']
				}
			}
			const result = serializeDates(customObj)
			expect(result).toEqual(['2026-01-20T12:00:00.000Z', 'other'])
		})
	})

	describe('Standard Schema with Date response', () => {
		// Mock Standard Schema interface
		const createMockDateSchema = () => ({
			'~standard': {
				version: 1,
				vendor: 'mock',
				validate: (value: unknown) => {
					if (typeof value === 'string') {
						// Check if valid ISO date string
						const date = new Date(value)
						if (!isNaN(date.getTime())) {
							return { value }
						}
					}
					return {
						issues: [{
							message: `Expected ISO date string, got ${typeof value}: ${value}`,
							path: []
						}]
					}
				}
			}
		})

		it('should serialize Date to ISO string before validation', async () => {
			const dateSchema = createMockDateSchema()

			const app = new Elysia().get(
				'/date',
				() => new Date('2026-01-20T12:00:00.000Z'),
				{
					response: {
						200: dateSchema
					}
				}
			)

			const response = await app.handle(
				new Request('http://localhost/date')
			)

			expect(response.status).toBe(200)
			const body = await response.text()
			// JSON.stringify wraps strings in quotes
			expect(body).toBe('2026-01-20T12:00:00.000Z')
		})

		it('should serialize Date in object response', async () => {
			const objectWithDateSchema = {
				'~standard': {
					version: 1,
					vendor: 'mock',
					validate: (value: unknown) => {
						if (
							typeof value === 'object' &&
							value !== null &&
							'createdAt' in value &&
							typeof (value as any).createdAt === 'string'
						) {
							return { value }
						}
						return {
							issues: [{
								message: `Expected object with ISO date string createdAt`,
								path: []
							}]
						}
					}
				}
			}

			const app = new Elysia().get(
				'/object',
				() => ({
					name: 'test',
					createdAt: new Date('2026-01-20T12:00:00.000Z')
				}),
				{
					response: {
						200: objectWithDateSchema
					}
				}
			)

			const response = await app.handle(
				new Request('http://localhost/object')
			)

			expect(response.status).toBe(200)
			const body = await response.json()
			expect(body).toEqual({
				name: 'test',
				createdAt: '2026-01-20T12:00:00.000Z'
			})
		})
	})
})
