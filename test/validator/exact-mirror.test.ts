import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

describe('Exact Mirror', () => {
	it('normalize when t.Transform is provided', async () => {
		const app = new Elysia({
			normalize: 'exactMirror'
		}).get('/', () => ({ count: 2, name: 'foo', extra: 1 }), {
			response: t.Object(
				{ name: t.String(), count: t.Optional(t.Integer()) },
				{ additionalProperties: false }
			)
		})
	})

	it('leave incorrect union field as-is', async () => {
		const app = new Elysia().post(
			'/test',
			({ body }) => {
				console.log({ body })

				return 'Hello Elysia'
			},
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
			() => {
				return {
					messages: [
						{
							message: 'Hello, world!',
							shouldBeRemoved: true
						}
					]
				}
			},
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
			() => [{ bar: 'asd', baz: true, qux: 'b', foo: 1 }],
			{ response: t.Array(OmittedUnionSchema) }
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual([{ qux: 'b', foo: 1 }])
	})

	it('normalize t.Omit(t.Union) response', async () => {
		const SchemaA = t.Object({ foo: t.Number() })
		const SchemaB = t.Object({ foo: t.Number(), baz: t.Boolean() })

		const UnionSchema = t.Union([SchemaA, SchemaB])
		const OmittedUnionSchema = t.Omit(UnionSchema, ['baz'])

		const app = new Elysia().get('/', () => ({ baz: true, foo: 1 }), {
			response: OmittedUnionSchema
		})

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ foo: 1 })
	})

	it('normalize t.Omit(t.Union) with multiple status codes', async () => {
		const SchemaA = t.Object({ foo: t.Number() })
		const SchemaB = t.Object({ foo: t.Number(), baz: t.Boolean() })

		const UnionSchema = t.Union([SchemaA, SchemaB])
		const OmittedUnionSchema = t.Omit(UnionSchema, ['baz'])

		const app = new Elysia().get('/', () => ({ baz: true, foo: 1 }), {
			response: {
				200: OmittedUnionSchema
			}
		})

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ foo: 1 })
	})
})
