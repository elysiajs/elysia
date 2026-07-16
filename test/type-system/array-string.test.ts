import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'
import { req } from '../utils'

describe('TypeSystem - ArrayString', () => {
	it('creates an empty array unless a default is provided', () => {
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

	it('accepts decoded arrays', () => {
		const schema = t.ArrayString(t.Number())

		expect(Value.Check(schema, [1])).toBe(true)
	})

	it('preserves arrays during encoding', () => {
		const schema = t.ArrayString(t.Number())

		expect(Value.Encode(schema, [1])).toEqual([1])
	})

	it('decodes JSON arrays and rejects non-array strings', () => {
		const schema = t.ArrayString(t.Number())

		expect(Value.Decode<typeof schema>(schema, '[1]')).toEqual([1])

		expect(Value.Check(schema, '1')).toBe(false)
	})

	it('decodes arrays in request bodies', async () => {
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
