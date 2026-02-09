/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Runtime verification that type-level input/output separation
 * matches actual runtime parsing behavior.
 *
 * These tests start a real Elysia server and verify that:
 * 1. Transformed schemas parse correctly at runtime
 * 2. The handler receives the transformed (output) values
 * 3. The client sends the raw (input) values
 *
 * This ensures our type-level changes are not just cosmetic
 * but reflect real Elysia behavior.
 */

import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import z from 'zod'

describe('Input/Output type separation - Runtime verification', () => {
	it('Zod transform: handler receives transformed body', async () => {
		const app = new Elysia().post('/transform', ({ body }) => {
			// At runtime, body.createdAt should be a Date
			return {
				nameType: typeof body.name,
				createdAtType: body.createdAt instanceof Date ? 'Date' : typeof body.createdAt,
				createdAtValue: body.createdAt instanceof Date ? body.createdAt.toISOString() : String(body.createdAt)
			}
		}, {
			body: z.object({
				name: z.string(),
				createdAt: z.string().transform((s) => new Date(s))
			})
		})

		const response = await app.handle(
			new Request('http://localhost/transform', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: 'test',
					createdAt: '2024-01-15T00:00:00.000Z'
				})
			})
		)

		const result = await response.json()
		expect(result.nameType).toBe('string')
		expect(result.createdAtType).toBe('Date')
		expect(result.createdAtValue).toBe('2024-01-15T00:00:00.000Z')
	})

	it('Zod transform: handler receives transformed query', async () => {
		const app = new Elysia().get('/query-transform', ({ query }) => {
			return {
				pageType: typeof query.page,
				pageValue: query.page,
				activeType: typeof query.active,
				activeValue: query.active
			}
		}, {
			query: z.object({
				page: z.string().transform(Number),
				active: z.string().transform((v) => v === 'true')
			})
		})

		const response = await app.handle(
			new Request('http://localhost/query-transform?page=5&active=true')
		)

		const result = await response.json()
		expect(result.pageType).toBe('number')
		expect(result.pageValue).toBe(5)
		expect(result.activeType).toBe('boolean')
		expect(result.activeValue).toBe(true)
	})

	it('Zod coerce: handler receives coerced values', async () => {
		const app = new Elysia().post('/coerce', ({ body }) => {
			return {
				countType: typeof body.count,
				countValue: body.count
			}
		}, {
			body: z.object({
				count: z.coerce.number()
			})
		})

		const response = await app.handle(
			new Request('http://localhost/coerce', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ count: '42' })
			})
		)

		const result = await response.json()
		expect(result.countType).toBe('number')
		expect(result.countValue).toBe(42)
	})

	it('Zod default: handler receives default value when omitted', async () => {
		const app = new Elysia().post('/default', ({ body }) => {
			return {
				nameValue: body.name,
				countValue: body.count
			}
		}, {
			body: z.object({
				name: z.string().default('anonymous'),
				count: z.number().default(0)
			})
		})

		const response = await app.handle(
			new Request('http://localhost/default', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			})
		)

		const result = await response.json()
		expect(result.nameValue).toBe('anonymous')
		expect(result.countValue).toBe(0)
	})

	it('TypeBox t.Numeric: handler receives number from string input', async () => {
		const app = new Elysia().post('/numeric', ({ body }) => {
			return {
				ageType: typeof body.age,
				ageValue: body.age
			}
		}, {
			body: t.Object({
				age: t.Numeric()
			})
		})

		const response = await app.handle(
			new Request('http://localhost/numeric', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ age: '25' })
			})
		)

		const result = await response.json()
		expect(result.ageType).toBe('number')
		expect(result.ageValue).toBe(25)
	})

	it('Nested Zod transforms: handler receives deeply transformed values', async () => {
		const app = new Elysia().post('/nested', ({ body }) => {
			return {
				userName: body.user.name,
				birthDateType: body.user.birthDate instanceof Date ? 'Date' : typeof body.user.birthDate,
				countType: typeof body.metadata.count
			}
		}, {
			body: z.object({
				user: z.object({
					name: z.string(),
					birthDate: z.string().transform((s) => new Date(s))
				}),
				metadata: z.object({
					count: z.string().transform(Number)
				})
			})
		})

		const response = await app.handle(
			new Request('http://localhost/nested', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					user: { name: 'Alice', birthDate: '1990-01-01T00:00:00.000Z' },
					metadata: { count: '10' }
				})
			})
		)

		const result = await response.json()
		expect(result.userName).toBe('Alice')
		expect(result.birthDateType).toBe('Date')
		expect(result.countType).toBe('number')
	})

	it('Plugin composition preserves runtime transform behavior', async () => {
		const plugin = new Elysia().post('/plugin-route', ({ body }) => {
			return {
				timestampType: body.timestamp instanceof Date ? 'Date' : typeof body.timestamp
			}
		}, {
			body: z.object({
				timestamp: z.string().transform((s) => new Date(s))
			})
		})

		const app = new Elysia().use(plugin)

		const response = await app.handle(
			new Request('http://localhost/plugin-route', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					timestamp: '2024-06-01T12:00:00.000Z'
				})
			})
		)

		const result = await response.json()
		expect(result.timestampType).toBe('Date')
	})

	it('Chained transforms: handler receives final transformed value', async () => {
		const app = new Elysia().post('/chained', ({ body }) => {
			return {
				valueType: typeof body.value,
				valueValue: body.value
			}
		}, {
			body: z.object({
				value: z.string().transform(Number).transform((n) => n > 0)
			})
		})

		const response = await app.handle(
			new Request('http://localhost/chained', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value: '42' })
			})
		)

		const result = await response.json()
		expect(result.valueType).toBe('boolean')
		expect(result.valueValue).toBe(true)
	})

	it('Routes metadata exposes ~Routes with input property', () => {
		const app = new Elysia().post('/test', () => 'ok', {
			body: z.object({
				data: z.string().transform(Number)
			})
		})

		// Verify the ~Routes brand field exists and has the expected structure
		type Routes = (typeof app)['~Routes']
		type Route = Routes['test']['post']

		// Verify input exists as a type-level property
		type HasInput = 'input' extends keyof Route ? true : false
		const check: HasInput = true
		expect(check).toBe(true)
	})
})
