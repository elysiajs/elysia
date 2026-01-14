import { Elysia } from '../../src'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

/**
 * Test for issue #1656: Returning non-JSON serializable response when using Elysia with Bun SQL
 * 
 * Problem: When returning an Array subclass (like Bun SQL results), Elysia was using
 * constructor.name === 'Array' to detect arrays, which fails for subclasses.
 * This caused the response to fall through to `new Response(response)` which
 * implicitly calls toString() resulting in "[object Object][object Object]".
 * 
 * Fix: Use Array.isArray() to properly detect all arrays including subclasses.
 */

// Simulate Bun SQL results - an array subclass with extra properties
class SQLResults extends Array<any> {
	statement: string = 'SELECT * FROM users'
	columns: string[] = ['id', 'name']

	constructor(...items: any[]) {
		super(...items)
		Object.setPrototypeOf(this, SQLResults.prototype)
	}
}

// Another common case: TypedArray-like results from ORMs
class ORMResultSet extends Array<any> {
	query: string
	duration: number

	constructor(query: string, duration: number, ...items: any[]) {
		super(...items)
		this.query = query
		this.duration = duration
		Object.setPrototypeOf(this, ORMResultSet.prototype)
	}
}

describe('Array Subclass Response Serialization', () => {
	describe('Issue #1656 - Bun SQL results', () => {
		it('should serialize Array subclass (SQLResults) as JSON', async () => {
			const app = new Elysia().get('/', () => {
				return new SQLResults(
					{ id: 1, name: 'Alice' },
					{ id: 2, name: 'Bob' }
				)
			})

			const response = await app.handle(req('/'))
			const data = await response.json()

			expect(response.headers.get('content-type')).toBe('application/json')
			expect(data).toEqual([
				{ id: 1, name: 'Alice' },
				{ id: 2, name: 'Bob' }
			])
		})

		it('should serialize Array subclass with set headers', async () => {
			const app = new Elysia().get('/', ({ set }) => {
				set.headers['X-Custom'] = 'test'
				return new SQLResults({ id: 1, name: 'Alice' })
			})

			const response = await app.handle(req('/'))
			const data = await response.json()

			expect(response.headers.get('content-type')).toBe('application/json')
			expect(response.headers.get('X-Custom')).toBe('test')
			expect(data).toEqual([{ id: 1, name: 'Alice' }])
		})

		it('should handle empty Array subclass', async () => {
			const app = new Elysia().get('/', () => {
				return new SQLResults()
			})

			const response = await app.handle(req('/'))
			const data = await response.json()

			expect(response.headers.get('content-type')).toBe('application/json')
			expect(data).toEqual([])
		})

		it('should serialize ORM result sets correctly', async () => {
			const app = new Elysia().get('/', () => {
				return new ORMResultSet(
					'SELECT * FROM products',
					42,
					{ id: 1, name: 'Widget', price: 9.99 },
					{ id: 2, name: 'Gadget', price: 19.99 }
				)
			})

			const response = await app.handle(req('/'))
			const data = await response.json()

			expect(response.headers.get('content-type')).toBe('application/json')
			expect(data).toEqual([
				{ id: 1, name: 'Widget', price: 9.99 },
				{ id: 2, name: 'Gadget', price: 19.99 }
			])
		})
	})

	describe('mapEarlyResponse with Array subclass', () => {
		it('should serialize Array subclass in beforeHandle', async () => {
			const app = new Elysia()
				.get('/', () => 'fallback', {
					beforeHandle: () => {
						return new SQLResults(
							{ id: 1, name: 'Early' }
						)
					}
				})

			const response = await app.handle(req('/'))
			const data = await response.json()

			expect(response.headers.get('content-type')).toBe('application/json')
			expect(data).toEqual([{ id: 1, name: 'Early' }])
		})

		it('should serialize Array subclass in beforeHandle with set headers', async () => {
			const app = new Elysia()
				.get('/', ({ set }) => {
					set.headers['X-Test'] = 'value'
					return 'fallback'
				}, {
					beforeHandle: ({ set }) => {
						set.status = 201
						return new SQLResults({ id: 1, created: true })
					}
				})

			const response = await app.handle(req('/'))
			const data = await response.json()

			expect(response.status).toBe(201)
			expect(response.headers.get('content-type')).toBe('application/json')
			expect(data).toEqual([{ id: 1, created: true }])
		})
	})

	describe('Nested Array subclasses', () => {
		it('should handle Array subclass containing nested arrays', async () => {
			const app = new Elysia().get('/', () => {
				return new SQLResults(
					{ id: 1, tags: ['a', 'b', 'c'] },
					{ id: 2, tags: ['d', 'e'] }
				)
			})

			const response = await app.handle(req('/'))
			const data = await response.json()

			expect(data).toEqual([
				{ id: 1, tags: ['a', 'b', 'c'] },
				{ id: 2, tags: ['d', 'e'] }
			])
		})

		it('should handle Array subclass containing nested objects', async () => {
			const app = new Elysia().get('/', () => {
				return new SQLResults(
					{
						id: 1,
						user: { name: 'Alice', email: 'alice@example.com' },
						orders: [{ orderId: 100 }, { orderId: 101 }]
					}
				)
			})

			const response = await app.handle(req('/'))
			const data = await response.json()

			expect(data).toEqual([
				{
					id: 1,
					user: { name: 'Alice', email: 'alice@example.com' },
					orders: [{ orderId: 100 }, { orderId: 101 }]
				}
			])
		})
	})

	describe('Regular arrays still work', () => {
		it('should still serialize regular arrays', async () => {
			const app = new Elysia().get('/', () => {
				return [{ id: 1 }, { id: 2 }]
			})

			const response = await app.handle(req('/'))
			const data = await response.json()

			expect(response.headers.get('content-type')).toBe('application/json')
			expect(data).toEqual([{ id: 1 }, { id: 2 }])
		})

		it('should still serialize plain objects', async () => {
			const app = new Elysia().get('/', () => {
				return { message: 'hello' }
			})

			const response = await app.handle(req('/'))
			const data = await response.json()

			expect(response.headers.get('content-type')).toBe('application/json')
			expect(data).toEqual({ message: 'hello' })
		})
	})
})
