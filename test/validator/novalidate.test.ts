import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('ElysiaType.NoValidate', () => {
	it('should bypass validation with t.NoValidate(t.String())', async () => {
		const app = new Elysia().get('/', () => 123 as unknown as string, {
			response: t.NoValidate(t.String())
		})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('123')
	})

	it('should bypass validation with t.NoValidate(t.Number())', async () => {
		const app = new Elysia().get(
			'/',
			() => 'not-a-number' as unknown as number,
			{
				response: t.NoValidate(t.Number())
			}
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('not-a-number')
	})

	it('should bypass validation with t.NoValidate(t.Boolean())', async () => {
		const app = new Elysia().get(
			'/',
			() => 'not-a-boolean' as unknown as boolean,
			{
				response: t.NoValidate(t.Boolean())
			}
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('not-a-boolean')
	})

	it('should bypass validation with t.NoValidate(t.Object())', async () => {
		const app = new Elysia().get(
			'/',
			() => 'invalid-object' as unknown as { name: string },
			{
				response: t.NoValidate(t.Object({ name: t.String() }))
			}
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('{}')
	})

	it('should bypass validation with t.NoValidate(t.Array())', async () => {
		const app = new Elysia().get(
			'/',
			() => 'not-an-array' as unknown as string[],
			{
				response: t.NoValidate(t.Array(t.String()))
			}
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('not-an-array')
	})

	it('should bypass validation with t.NoValidate(t.Union())', async () => {
		const app = new Elysia().get(
			'/',
			() => 'invalid' as unknown as string | number,
			{
				response: t.NoValidate(
					t.Union([
						t.String({ minLength: 10 }),
						t.Number({ minimum: 100 })
					])
				)
			}
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('invalid')
	})

	it('should bypass validation with t.NoValidate(t.Date())', async () => {
		const app = new Elysia().get(
			'/',
			() => 'Hello Elysia' as unknown as Date,
			{
				response: t.NoValidate(t.Date())
			}
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('Hello Elysia')
	})

	it('should bypass validation with t.NoValidate(t.Ref())', async () => {
		const app = new Elysia()
			.model({ score: t.Number() })
			// @ts-expect-error
			.get('/', () => 'string instead of number!', {
				response: t.NoValidate(t.Ref('score'))
			})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('string instead of number!')
	})

	it('should work with actual Date when using t.NoValidate(t.Date())', async () => {
		const testDate = new Date('2025-01-01T00:00:00Z')
		const app = new Elysia().get('/', () => testDate, {
			response: t.NoValidate(t.Date())
		})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.text()).toBe(testDate.toString())
	})

	it('should bypass validation with t.NoValidate(t.Numeric())', async () => {
		const app = new Elysia().get(
			'/',
			() => 'not-a-number' as unknown as number,
			{
				response: t.NoValidate(t.Numeric())
			}
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('not-a-number')
	})

	it('should bypass validation with t.NoValidate(t.BooleanString())', async () => {
		const app = new Elysia().get(
			'/',
			() => 'invalid-boolean' as unknown as boolean,
			{
				response: t.NoValidate(t.BooleanString())
			}
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('invalid-boolean')
	})

	it('should work with NoValidate in specific status codes', async () => {
		const app = new Elysia().get(
			'/',
			({ set }) => {
				set.status = 201
				return 'Hello' as unknown as Date
			},
			{
				response: {
					200: t.String(),
					201: t.NoValidate(t.Date())
				}
			}
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(201)
		expect(await res.text()).toBe('Hello')
	})

	it('should validate normally for non-NoValidate status codes', async () => {
		const app = new Elysia().get(
			'/',
			({ set }) => {
				set.status = 200
				return 'Hello' as unknown as Date
			},
			{
				response: {
					200: t.Date(),
					201: t.NoValidate(t.Date())
				}
			}
		)

		const res = await app.handle(req('/'))

		// Response validation errors return 500 (server error) - see issue #1480
		expect(res.status).toBe(500)
	})

	it('should work with NoValidate on nested object properties', async () => {
		const app = new Elysia().get(
			'/',
			// @ts-expect-error
			() => ({
				user: { age: '123', name: true },
				timestamp: '2025-01-01T00:00:00Z'
			}),
			{
				response: t.NoValidate(
					t.Object({
						user: t.Object({
							name: t.String(),
							age: t.Number()
						}),
						timestamp: t.Date()
					})
				)
			}
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			user: { age: '123', name: true },
			timestamp: '2025-01-01T00:00:00Z'
		})
	})

	it('should validate normally when NOT using NoValidate', async () => {
		const app = new Elysia().get(
			'/',
			() => 'Hello Elysia' as unknown as Date,
			{
				response: t.Date()
			}
		)

		const res = await app.handle(req('/'))

		// Response validation errors return 500 (server error) - see issue #1480
		expect(res.status).toBe(500)
	})

	it('should validate normally with strict object schemas', async () => {
		const app = new Elysia()
			// @ts-expect-error
			.get('/', () => ({ name: 'John' }), {
				response: t.Object({
					name: t.String(),
					age: t.Number()
				})
			})

		const res = await app.handle(req('/'))

		// Response validation errors return 500 (server error) - see issue #1480
		expect(res.status).toBe(500)
	})

	it('should handle null values with NoValidate', async () => {
		const app = new Elysia()
			// @ts-expect-error
			.get('/', () => null, {
				response: t.NoValidate(t.String())
			})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('')
	})

	it('should handle undefined values with NoValidate', async () => {
		const app = new Elysia()
			// @ts-expect-error
			.get('/', () => undefined, {
				response: t.NoValidate(t.String())
			})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('')
	})

	it('should work with NoValidate on multiple union types', async () => {
		const app = new Elysia().get(
			'/',
			() => 'test' as unknown as string | number | boolean,
			{
				response: t.NoValidate(
					t.Union([t.String(), t.Number(), t.Boolean()])
				)
			}
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('test')
	})

	it('bypasses Encode when encodeSchema=true (Date)', async () => {
		const app = new Elysia({ encodeSchema: true }).get(
			'/',
			// @ts-expect-error
			() => 'Hello Elysia',
			{ response: t.NoValidate(t.Date()) }
		)
		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('Hello Elysia')
	})

	it('bypasses Encode with NoValidate(t.Ref(Date)) when encodeSchema=true', async () => {
		const app = new Elysia({ encodeSchema: true })
			.model({ createdAt: t.Date() })
			// @ts-expect-error
			.get('/', () => 'Hello', {
				response: t.NoValidate(t.Ref('createdAt'))
			})
		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('Hello')
	})
})
