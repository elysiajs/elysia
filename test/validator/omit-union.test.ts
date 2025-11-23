import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { req } from '../utils'

describe('Omit with Union normalization', () => {
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
