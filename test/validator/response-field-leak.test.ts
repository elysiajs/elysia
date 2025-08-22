import { Elysia, t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Response Field Leak Prevention', () => {
	it('should not leak extra fields in nested array objects', async () => {
		const UserRead = t.Object({
			username: t.String()
		})

		const app = new Elysia()
			.get(
				'/',
				() => {
					return {
						hasMore: true,
						total: 1,
						offset: 0,
						totalPages: 1,
						currentPage: 1,
						items: [{ username: 'Bob', secret: 'shhh' }]
					}
				},
				{
					response: {
						200: t.Object({
							hasMore: t.Boolean(),
							items: t.Array(UserRead),
							total: t.Integer({ minimum: 0 }),
							offset: t.Integer({ minimum: 0 }),
							limit: t.Optional(t.Integer({ minimum: 1 })),
							totalPages: t.Integer({ minimum: 1 }),
							currentPage: t.Integer({ minimum: 1 })
						})
					}
				}
			)

		const response = await app.handle(req('/'))
		const data = await response.json()

		expect(data).toEqual({
			hasMore: true,
			total: 1,
			offset: 0,
			totalPages: 1,
			currentPage: 1,
			items: [{ username: 'Bob' }] // secret should be removed
		})

		// Verify secret field is not present
		expect(data.items[0]).not.toHaveProperty('secret')
	})

	it('should not leak extra fields regardless of property order', async () => {
		const UserRead = t.Object({
			username: t.String()
		})

		// Test without hasMore as first property
		const app = new Elysia()
			.get(
				'/no-hasmore',
				() => {
					return {
						total: 1,
						offset: 0,
						totalPages: 1,
						currentPage: 1,
						items: [{ username: 'Alice', password: 'hidden' }]
					}
				},
				{
					response: {
						200: t.Object({
							items: t.Array(UserRead),
							total: t.Integer({ minimum: 0 }),
							offset: t.Integer({ minimum: 0 }),
							totalPages: t.Integer({ minimum: 1 }),
							currentPage: t.Integer({ minimum: 1 })
						})
					}
				}
			)

		const response = await app.handle(req('/no-hasmore'))
		const data = await response.json()

		expect(data).toEqual({
			total: 1,
			offset: 0,
			totalPages: 1,
			currentPage: 1,
			items: [{ username: 'Alice' }] // password should be removed
		})

		// Verify password field is not present
		expect(data.items[0]).not.toHaveProperty('password')
	})

	it('should handle deeply nested objects with extra fields', async () => {
		const Address = t.Object({
			street: t.String(),
			city: t.String()
		})

		const User = t.Object({
			name: t.String(),
			address: Address
		})

		const app = new Elysia()
			.get(
				'/nested',
				() => {
					return {
						user: {
							name: 'John',
							age: 30, // extra field
							address: {
								street: '123 Main St',
								city: 'New York',
								country: 'USA', // extra field
								postalCode: '10001' // extra field
							}
						}
					}
				},
				{
					response: {
						200: t.Object({
							user: User
						})
					}
				}
			)

		const response = await app.handle(req('/nested'))
		const data = await response.json()

		expect(data).toEqual({
			user: {
				name: 'John',
				address: {
					street: '123 Main St',
					city: 'New York'
				}
			}
		})

		// Verify extra fields are not present
		expect(data.user).not.toHaveProperty('age')
		expect(data.user.address).not.toHaveProperty('country')
		expect(data.user.address).not.toHaveProperty('postalCode')
	})

	it('should work with multiple items in array', async () => {
		const Item = t.Object({
			id: t.Number(),
			name: t.String()
		})

		const app = new Elysia()
			.get(
				'/multiple',
				() => {
					return {
						items: [
							{ id: 1, name: 'Item 1', secret: 'secret1', extra: 'data1' },
							{ id: 2, name: 'Item 2', secret: 'secret2', extra: 'data2' },
							{ id: 3, name: 'Item 3', secret: 'secret3', extra: 'data3' }
						]
					}
				},
				{
					response: {
						200: t.Object({
							items: t.Array(Item)
						})
					}
				}
			)

		const response = await app.handle(req('/multiple'))
		const data = await response.json()

		expect(data).toEqual({
			items: [
				{ id: 1, name: 'Item 1' },
				{ id: 2, name: 'Item 2' },
				{ id: 3, name: 'Item 3' }
			]
		})

		// Verify no extra fields in any item
		data.items.forEach((item: any) => {
			expect(item).not.toHaveProperty('secret')
			expect(item).not.toHaveProperty('extra')
		})
	})

	it('should preserve fields when additionalProperties is explicitly true', async () => {
		const FlexibleSchema = t.Object(
			{
				required: t.String()
			},
			{ additionalProperties: true }
		)

		const app = new Elysia()
			.get(
				'/flexible',
				() => {
					return {
						required: 'value',
						extra1: 'should remain',
						extra2: 123
					}
				},
				{
					response: {
						200: FlexibleSchema
					}
				}
			)

		const response = await app.handle(req('/flexible'))
		const data = await response.json()

		// When additionalProperties is true, extra fields should be preserved
		expect(data).toEqual({
			required: 'value',
			extra1: 'should remain',
			extra2: 123
		})
	})

	it('should handle mixed schemas with optional properties', async () => {
		const Schema = t.Object({
			required: t.String(),
			optional: t.Optional(t.String()),
			nested: t.Object({
				field: t.String()
			})
		})

		const app = new Elysia()
			.get(
				'/mixed',
				() => {
					return {
						required: 'present',
						optional: 'also present',
						extra: 'should be removed',
						nested: {
							field: 'value',
							extraNested: 'should be removed'
						}
					}
				},
				{
					response: {
						200: Schema
					}
				}
			)

		const response = await app.handle(req('/mixed'))
		const data = await response.json()

		expect(data).toEqual({
			required: 'present',
			optional: 'also present',
			nested: {
				field: 'value'
			}
		})

		expect(data).not.toHaveProperty('extra')
		expect(data.nested).not.toHaveProperty('extraNested')
	})

	it('should handle the exact bug report scenario', async () => {
		// This is the exact reproduction case from the bug report
		const UserRead = t.Object({
			username: t.String()
		})

		const app = new Elysia()
			.get(
				'/',
				() => {
					return {
						hasMore: true,
						total: 1,
						offset: 0,
						totalPages: 1,
						currentPage: 1,
						items: [{ username: 'Bob', secret: 'shhh' }]
					}
				},
				{
					response: {
						200: t.Object({
							hasMore: t.Boolean(),
							items: t.Array(UserRead),
							total: t.Integer({ minimum: 0 }),
							offset: t.Integer({ minimum: 0 }),
							limit: t.Optional(t.Integer({ minimum: 1 })),
							totalPages: t.Integer({ minimum: 1 }),
							currentPage: t.Integer({ minimum: 1 })
						})
					}
				}
			)

		const response = await app.handle(req('/'))
		expect(response.status).toBe(200)

		const data = await response.json()

		// The bug was that secret field was leaking
		expect(data.items[0].username).toBe('Bob')
		expect(data.items[0].secret).toBeUndefined()
		expect('secret' in data.items[0]).toBe(false)
	})
})