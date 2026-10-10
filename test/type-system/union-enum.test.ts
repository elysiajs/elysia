import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'
import { post, json } from '../utils'

describe('TypeSystem - UnionEnum', () => {
	it('Create uses an explicit default', () => {
		expect(
			Value.Create(t.UnionEnum(['some', 'data'], { default: 'data' }))
		).toEqual('data')
	})

	it('Allows readonly', () => {
		const readonlyArray = ['some', 'data'] as const
		expect(Value.Check(t.UnionEnum(readonlyArray), 'data')).toBe(true)
	})

	it('Check', () => {
		const schema = t.UnionEnum(['some', 'data'])

		expect(Value.Check(schema, 'some')).toBe(true)
		expect(Value.Check(schema, 'data')).toBe(true)

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
		expect(
			(t.UnionEnum(['some', 1]) as { type?: string }).type
		).toBeUndefined()
		expect(t.UnionEnum([2, 1])).toMatchObject({
			type: 'number',
			enum: [2, 1]
		})
	})

	it('Integrate', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					value: t.UnionEnum(['some', 1])
				})
			},
			({ body }) => body
		)
		const res1 = await app.handle('/', json({ value: 1 }))
		expect(res1.status).toBe(200)

		const res2 = await app.handle('/', json({ value: 'some' }))
		expect(res2.status).toBe(200)

		const res3 = await app.handle('/', json({ value: 'data' }))
		expect(res3.status).toBe(422)
	})

	// a required field must not be filled in with the first member: a client
	// that omits `role` would otherwise be handed `role: 'admin'`
	it('rejects a missing required field', async () => {
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ role: t.UnionEnum(['admin', 'user']) }) },
			({ body }) => body
		)

		const res = await app.handle('/', json({}))
		expect(res.status).toBe(422)

		const body = await res.json()
		if (process.env.NODE_ENV === 'production')
			expect(body.expected).toBeUndefined()
		else expect(body.expected).toEqual({})
	})

	it('fills a missing field from an explicit default', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					role: t.UnionEnum(['admin', 'user'], { default: 'user' })
				})
			},
			({ body }) => body
		)

		const res = await app.handle('/', json({}))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ role: 'user' })
	})
})
