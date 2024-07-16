import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { req } from '../utils'

describe('TypeSystem - ObjectString', () => {
	it('Create', () => {
		expect(Value.Create(t.ObjectString({}))).toBe('{}')
	})

	it('Check', () => {
		const schema = t.ObjectString({
			pageIndex: t.Number(),
			pageLimit: t.Number()
		})

		expect(Value.Check(schema, { pageIndex: 1, pageLimit: 1 })).toBe(true)
	})

	it('Encode', () => {
		const schema = t.ObjectString({
			pageIndex: t.Number(),
			pageLimit: t.Number()
		})

		expect(
			Value.Encode<typeof schema, string>(schema, {
				pageIndex: 1,
				pageLimit: 1
			})
		).toBe(JSON.stringify({ pageIndex: 1, pageLimit: 1 }))

		expect(
			Value.Encode<typeof schema, string>(schema, {
				pageIndex: 1,
				pageLimit: 1
			})
		).toBe(JSON.stringify({ pageIndex: 1, pageLimit: 1 }))
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
})
