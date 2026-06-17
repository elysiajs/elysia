import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

describe('Exact Mirror', () => {
	it('normalize when t.Codec is provided', async () => {
		const app = new Elysia({
			normalize: 'exactMirror'
		}).get(
			'/',
			{
				response: t.Object(
					{ name: t.String(), count: t.Optional(t.Integer()) },
					{ additionalProperties: false }
				)
			},
			() => ({ count: 2, name: 'foo', extra: 1 })
		)
	})

	it('leave incorrect union field as-is', async () => {
		const app = new Elysia().post(
			'/test',
			{
				body: t.Object({
					foo: t.Optional(
						t.Nullable(
							t.Number({
								// 'foo' but be either number, optional or nullable
								error: 'Must be a number'
							})
						)
					)
				})
			},
			({ body }) => {
				console.log({ body })

				return 'Hello Elysia'
			}
		)

		const response = await app.handle(
			post('/test', {
				foo: 'asd'
			})
		)

		expect(response.status).toEqual(422)
	})

	it('normalize array response', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: {
					200: t.Object({
						messages: t.Array(
							t.Object({
								message: t.String()
							})
						)
					})
				}
			},
			() => {
				return {
					messages: [
						{
							message: 'Hello, world!',
							shouldBeRemoved: true
						}
					]
				}
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			messages: [{ message: 'Hello, world!' }]
		})
	})

	it('normalize t.Array with t.Omit(t.Union) elements', async () => {
		const SharedSchemaA = t.Object({ qux: t.Literal('a') })
		const SharedSchemaB = t.Object({ qux: t.Literal('b') })
		const SchemaA = t.Object({ foo: t.Number() })
		const SchemaB = t.Object({ foo: t.Number(), baz: t.Boolean() })

		const IntersectSchemaA = t.Intersect([SchemaA, SharedSchemaA])
		const IntersectSchemaB = t.Intersect([SchemaB, SharedSchemaB])

		const UnionSchema = t.Union([IntersectSchemaA, IntersectSchemaB])
		const OmittedUnionSchema = t.Omit(UnionSchema, ['baz'])

		const app = new Elysia().get(
			'/',
			// @ts-ignore
			{ response: t.Array(OmittedUnionSchema) },
			() => [{ bar: 'asd', baz: true, qux: 'b', foo: 1 }]
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual([{ qux: 'b', foo: 1 }])
	})

	it('normalize t.Omit(t.Union) response', async () => {
		const SchemaA = t.Object({ foo: t.Number() })
		const SchemaB = t.Object({ foo: t.Number(), baz: t.Boolean() })

		const UnionSchema = t.Union([SchemaA, SchemaB])
		const OmittedUnionSchema = t.Omit(UnionSchema, ['baz'])

		const app = new Elysia().get(
			'/',
			{
				response: OmittedUnionSchema
			},
			() => ({ baz: true, foo: 1 })
		)

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({ foo: 1 })
	})

	it('normalize t.Omit(t.Union) with multiple status codes', async () => {
		const SchemaA = t.Object({ foo: t.Number() })
		const SchemaB = t.Object({ foo: t.Number(), baz: t.Boolean() })

		const UnionSchema = t.Union([SchemaA, SchemaB])
		const OmittedUnionSchema = t.Omit(UnionSchema, ['baz'])

		const app = new Elysia().get(
			'/',
			{
				response: {
					200: OmittedUnionSchema
				}
			},
			() => ({ baz: true, foo: 1 })
		)

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({ foo: 1 })
	})
})
