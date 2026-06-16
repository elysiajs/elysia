import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'
import { req } from '../utils'

describe('TypeSystem - ObjectString', () => {
	it('Create', () => {
		expect(Value.Create(t.ObjectString({}))).toEqual({})
		expect(
			Value.Create(
				t.ObjectString({}, {
					default: '{}'
				})
			)
		).toBe('{}')
	})

	it('Check', () => {
		const schema = t.ObjectString({
			pageIndex: t.Number(),
			pageLimit: t.Number()
		})

		expect(Value.Check(schema, { pageIndex: 1, pageLimit: 1 })).toBe(true)
	})

	it('Encode', () => {
		// ObjectString is a decode-only codec (string -> object); the encode
		// direction is intentionally not implemented.
		const schema = t.ObjectString({
			pageIndex: t.Number(),
			pageLimit: t.Number()
		})

		expect(() =>
			Value.Encode(schema, {
				pageIndex: 1,
				pageLimit: 1
			})
		).toThrow()
	})

	it('Decode', () => {
		const schema = t.ObjectString({
			pageIndex: t.Number(),
			pageLimit: t.Number()
		})

		expect(
			Value.Decode<typeof schema>(
				schema,
				JSON.stringify({
					pageIndex: 1,
					pageLimit: 1
				})
			)
		).toEqual({ pageIndex: 1, pageLimit: 1 })

		expect(() =>
			Value.Decode<typeof schema>(
				schema,
				JSON.stringify({
					pageLimit: 1
				})
			)
		).toThrow()
	})

	it('Integrate', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				pagination: t.ObjectString({
					pageIndex: t.Number(),
					pageLimit: t.Number()
				})
			})
		})

		const res1 = await app.handle(
			req('/?pagination={"pageIndex":1,"pageLimit":1}')
		)
		expect(res1.status).toBe(200)

		const res2 = await app.handle(req('/?pagination={"pageLimit":1}'))
		expect(res2.status).toBe(422)
	})

	it('Optional', async () => {
		const schema = t.Object({
			name: t.String(),
			metadata: t.Optional(t.ObjectString({
				pageIndex: t.Number(),
				pageLimit: t.Number()
			}))
		})

		expect(Value.Check(schema, { name: 'test' })).toBe(true)
		expect(Value.Create(schema).metadata).toBeUndefined()

		expect(Value.Check(schema, {
			name: 'test',
			metadata: { pageIndex: 1, pageLimit: 10 }
		})).toBe(true)
		expect(Value.Check(schema, { name: 'test', metadata: {} })).toBe(false)
	})

	it('Default value', async () => {
		const schema = t.ObjectString({
			pageIndex: t.Number(),
			pageLimit: t.Number()
		}, {
			default: { pageIndex: 0, pageLimit: 10 }
		})

		expect(Value.Create(schema)).toEqual({ pageIndex: 0, pageLimit: 10 })

		expect(Value.Check(schema, { pageIndex: 1, pageLimit: 20 })).toBe(true)
		expect(Value.Check(schema, { pageIndex: 0, pageLimit: 10 })).toBe(true)
		expect(Value.Check(schema, JSON.stringify({ pageIndex: 1, pageLimit: 20 }))).toBe(true)
		expect(Value.Check(schema, JSON.stringify({ pageIndex: 0, pageLimit: 10 }))).toBe(true)

		expect(Value.Check(schema, {})).toBe(false)
		expect(Value.Check(schema, { pageIndex: 1 })).toBe(false)
		expect(Value.Check(schema, undefined)).toBe(false)
	})
})
