import { Elysia, setupTypebox, t } from '../../src'

import { afterEach, describe, expect, it } from 'bun:test'
import { post, req } from '../utils'
import { TypeBoxValidator } from '../../src/type/validator'
import {
	getExactMirror,
	setExactMirror
} from '../../src/type/validator/exact-mirror'
import { Validator } from '../../src/validator'

const installedMirror = getExactMirror()

afterEach(() => {
	setExactMirror(installedMirror)
	Validator.clear()
})

describe('without exact-mirror', () => {
	it('keeps TypeBox normalization available through Value.Clean', () => {
		setExactMirror(undefined)

		const validator = new TypeBoxValidator(t.Object({ value: t.String() }))

		expect(validator.Clean!({ value: 'ok', extra: true })).toEqual({
			value: 'ok'
		})
	})

	it('keeps TypeBox codec encode available', () => {
		setExactMirror(undefined)

		const validator = new TypeBoxValidator(t.Object({ at: t.Date() }), {
			slot: 'response:200'
		})

		expect(validator.EncodeFrom({ at: new Date(0) })).toEqual({
			at: '1970-01-01T00:00:00.000Z'
		})
	})

	it('keeps TypeBox codec decode available', () => {
		setExactMirror(undefined)

		const validator = new TypeBoxValidator(t.Object({ at: t.Date() }))
		const decoded = validator.FromSync({
			at: '1970-01-01T00:00:00.000Z'
		} as any)

		expect(decoded).toEqual({ at: new Date(0) })
	})

	it('fails loud when exact-mirror behavior is explicitly requested', () => {
		setExactMirror(undefined)
		const schema = t.Object({ value: t.String() })

		expect(
			() => new TypeBoxValidator(schema, { normalize: 'exactMirror' })
		).toThrow('exact-mirror is required')
		expect(
			() => new TypeBoxValidator(schema, { normalize: true })
		).toThrow('exact-mirror is required')
		expect(
			() =>
				new TypeBoxValidator(schema, {
					sanitize: (value) => value
				})
		).toThrow('exact-mirror is required')
	})

	it('allows explicit registration in runtimes without require', () => {
		expect(typeof installedMirror).toBe('function')
		setExactMirror(undefined)
		setupTypebox({ exactMirror: installedMirror })

		expect(getExactMirror()).toBe(installedMirror)
	})
})

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
