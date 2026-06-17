import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('ElysiaType.NoValidate', () => {
	it('should bypass validation with t.NoValidate(t.String())', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.NoValidate(t.String())
			},
			() => 123 as unknown as string
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('123')
	})

	it('should bypass validation with t.NoValidate(t.Number())', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.NoValidate(t.Number())
			},
			() => 'not-a-number' as unknown as number
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('not-a-number')
	})

	it('should bypass validation with t.NoValidate(t.Boolean())', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.NoValidate(t.Boolean())
			},
			() => 'not-a-boolean' as unknown as boolean
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('not-a-boolean')
	})

	it('should bypass validation with t.NoValidate(t.Object())', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.NoValidate(t.Object({ name: t.String() }))
			},
			() => 'invalid-object' as unknown as { name: string }
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('{}')
	})

	it('should bypass validation with t.NoValidate(t.Array())', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.NoValidate(t.Array(t.String()))
			},
			() => 'not-an-array' as unknown as string[]
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('not-an-array')
	})

	it('should bypass validation with t.NoValidate(t.Union())', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.NoValidate(
					t.Union([
						t.String({ minLength: 10 }),
						t.Number({ minimum: 100 })
					])
				)
			},
			() => 'invalid' as unknown as string | number
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('invalid')
	})

	it('should bypass validation with t.NoValidate(t.Date())', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.NoValidate(t.Date())
			},
			() => 'Hello Elysia' as unknown as Date
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('Hello Elysia')
	})

	it('should bypass validation with t.NoValidate(t.Ref())', async () => {
		const app = new Elysia().model({ score: t.Number() }).get(
			'/',
			{
				response: t.NoValidate(t.Ref('score'))
			},
			// @ts-expect-error
			() => 'string instead of number!'
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('string instead of number!')
	})

	it('should work with actual Date when using t.NoValidate(t.Date())', async () => {
		// Under strict "skip Check only", Date's bidirectional codec still
		// runs Encode → ISO string (instead of the JS .toString() form the
		// raw response handler would produce).
		const testDate = new Date('2025-01-01T00:00:00Z')
		const app = new Elysia().get(
			'/',
			{
				response: t.NoValidate(t.Date())
			},
			() => testDate
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe(testDate.toISOString())
	})

	it('should bypass validation with t.NoValidate(t.Numeric())', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.NoValidate(t.Numeric())
			},
			() => 'not-a-number' as unknown as number
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('not-a-number')
	})

	// `t.BooleanString` and `t.Numeric` use unidirectional `Type.Decode`
	// codecs (Decode-only; Encode throws "Encode not implemented").
	// `NoValidate` follows a "skip Check, never reject" contract — when
	// the codec's Encode throws, the value passes through unchanged
	// instead of surfacing as 422.
	it('NoValidate(t.BooleanString()) passes through on Encode failure', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.NoValidate(t.BooleanString())
			},
			() => true
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('true')
	})

	it('should work with NoValidate in specific status codes', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: {
					200: t.String(),
					201: t.NoValidate(t.Date())
				}
			},
			({ set }) => {
				set.status = 201
				return 'Hello' as unknown as Date
			}
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(201)
		await expect(res.text()).resolves.toBe('Hello')
	})

	it('should validate normally for non-NoValidate status codes', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: {
					200: t.Date(),
					201: t.NoValidate(t.Date())
				}
			},
			({ set }) => {
				set.status = 200
				return 'Hello' as unknown as Date
			}
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(422)
	})

	it('should work with NoValidate on nested object properties', async () => {
		const app = new Elysia().get(
			'/',
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
			},
			// @ts-expect-error
			() => ({
				user: { age: '123', name: true },
				timestamp: '2025-01-01T00:00:00Z'
			})
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({
			user: { age: '123', name: true },
			timestamp: '2025-01-01T00:00:00Z'
		})
	})

	it('should validate normally when NOT using NoValidate', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Date()
			},
			() => 'Hello Elysia' as unknown as Date
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(422)
	})

	it('should validate normally with strict object schemas', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Object({
					name: t.String(),
					age: t.Number()
				})
			},
			// @ts-expect-error
			() => ({ name: 'John' })
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(422)
	})

	it('should handle null values with NoValidate', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.NoValidate(t.String())
			},
			// @ts-expect-error
			() => null
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('')
	})

	it('should handle undefined values with NoValidate', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.NoValidate(t.String())
			},
			// @ts-expect-error
			() => undefined
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('')
	})

	it('should work with NoValidate on multiple union types', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.NoValidate(
					t.Union([t.String(), t.Number(), t.Boolean()])
				)
			},
			() => 'test' as unknown as string | number | boolean
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('test')
	})

	it('passes string through NoValidate(t.Date()) — Date.Encode handles non-Date input', async () => {
		// `t.Date()`'s Encode is `(v) => v instanceof Date ? toISOString : v + ''`,
		// so a string return is encoded into itself. Under strict skip-Check-only
		// semantic, Encode still runs but doesn't break for primitive strings.
		const app = new Elysia().get(
			'/',
			{ response: t.NoValidate(t.Date()) },
			() => 'Hello Elysia' as any
		)
		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('Hello Elysia')
	})

	it('passes string through NoValidate(t.Ref(Date))', async () => {
		const app = new Elysia().model({ createdAt: t.Date() }).get(
			'/',
			{
				response: t.NoValidate(t.Ref('createdAt'))
			},
			() => 'Hello' as any
		)
		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('Hello')
	})
})
