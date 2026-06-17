import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'
import { req } from '../utils'

describe('TypeSystem - ArrayString', () => {
	it('Create', () => {
		// @ts-expect-error t.ArrayString requires an items schema
		expect(Value.Create(t.ArrayString())).toEqual([])

		expect(
			Value.Create(
				t.ArrayString(t.Any(), {
					default: '[]'
				})
			)
		).toBe('[]')
	})

	it('Check', () => {
		const schema = t.ArrayString(t.Number())

		expect(Value.Check(schema, [1])).toBe(true)
	})

	it('Encode', () => {
		// ArrayString is a decode-only codec (string -> array); the encode
		// direction is intentionally not implemented.
		const schema = t.ArrayString(t.Number())

		expect(() => Value.Encode(schema, [1])).toThrow()
	})

	it('Decode', () => {
		const schema = t.ArrayString(t.Number())

		expect(Value.Decode<typeof schema>(schema, '[1]')).toEqual([1])

		// `Value.Decode` runs Convert before its Check gate so it coerces
		// loosely; the framework validates with Check (`FromSync` Checks
		// before decoding), which rejects a non-array string.
		expect(Value.Check(schema, '1')).toBe(false)
	})

	it('Integrate', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					id: t.ArrayString(t.Number())
				})
			},
			({ body }) => body
		)

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
