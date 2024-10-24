import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'

describe('TypeSystem - ArrayString', () => {
	it('Create', () => {
		const value = Value.Create(t.ArrayString())
		expect(value).toBe('[]')
	})

	it('Check - String', () => {
		const schema = t.ArrayString(t.Number())

		expect(Value.Check(schema, '[1]')).toBe(true)
	})

	it('Check - Cast', () => {
		const schema = t.ArrayString(t.Number())

		expect(Value.Check(schema, [1])).toBe(true)
	})

	it('Encode', () => {
		const schema = t.ArrayString(t.Number())

		expect(Value.Encode<typeof schema>(schema, [1])).toBe(
			JSON.stringify([1])
		)

		expect(Value.Encode<typeof schema>(schema, [1])).toBe(
			JSON.stringify([1])
		)
	})

	it('Decode', () => {
		const schema = t.ArrayString(t.Number())

		expect(Value.Decode<typeof schema>(schema, '[1]')).toEqual([1])

		expect(() => Value.Decode<typeof schema>(schema, '1')).toThrow()
	})

	it('Integrate', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				id: t.ArrayString(t.Number())
			})
		})

		const res1 = await app.handle(
			new Request('http://localhost', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: JSON.stringify([1, 2, 3]) })
			})
		)
		expect(res1.status).toBe(200)

		const res2 = await app.handle(
			new Request('http://localhost', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: [1, 2, 3] })
			})
		)
		expect(res2.status).toBe(200)

		const res3 = await app.handle(
			new Request('http://localhost', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: ['a', 2, 3] })
			})
		)
		expect(res3.status).toBe(422)
	})
})
