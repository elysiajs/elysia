import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { post } from '../utils'

describe('TypeSystem - UnionEnum', () => {
	it('Create', () => {
		expect(Value.Create(t.UnionEnum(['some', 'data']))).toEqual('some')
	})

	it('Allows readonly', () => {
		const readonlyArray = ['some', 'data'] as const
		expect(Value.Create(t.UnionEnum(readonlyArray))).toEqual('some')
	})

	it('Check', () => {
		const schema = t.UnionEnum(['some', 'data', null])

		expect(Value.Check(schema, 'some')).toBe(true)
		expect(Value.Check(schema, 'data')).toBe(true)
		expect(Value.Check(schema, null)).toBe(true)

		expect(Value.Check(schema, { deep: 2 })).toBe(false)
		expect(Value.Check(schema, 'yay')).toBe(false)
		expect(Value.Check(schema, 42)).toBe(false)
		expect(Value.Check(schema, {})).toBe(false)
		expect(Value.Check(schema, undefined)).toBe(false)
	})
	it('JSON schema', () => {
		expect(t.UnionEnum(['some', 'data'])).toMatchObject({
			type: 'string',
			enum: ['some', 'data']
		})
		expect(t.UnionEnum(['some', 1]).type).toBeUndefined()
		expect(t.UnionEnum([2, 1])).toMatchObject({
			type: 'number',
			enum: [2, 1]
		})
		expect(t.UnionEnum([null])).toMatchObject({
			type: 'null',
			enum: [null]
		})
	})
	it('Integrate', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				value: t.UnionEnum(['some', 1, null])
			})
		})
		const res1 = await app.handle(post('/', { value: 1 }))
		expect(res1.status).toBe(200)

		const res2 = await app.handle(post('/', { value: null }))
		expect(res2.status).toBe(200)

		const res3 = await app.handle(post('/', { value: 'some' }))
		expect(res3.status).toBe(200)

		const res4 = await app.handle(post('/', { value: 'data' }))
		expect(res4.status).toBe(422)
	})
})
