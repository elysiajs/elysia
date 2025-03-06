import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { replaceSchemaType } from '../../src/schema'
import { req } from '../utils'

describe('Replace Schema Type', () => {
	it('replace primitive', async () => {
		expect(
			replaceSchemaType(t.String(), {
				from: t.String(),
				to: () => t.Number()
			})
		).toMatchObject(t.Number())
	})

	it('replace object properties', async () => {
		expect(
			replaceSchemaType(
				t.Object({
					id: t.Number(),
					name: t.String()
				}),
				{
					from: t.Number(),
					to: () => t.Numeric()
				}
			)
		).toMatchObject(
			t.Object({
				id: t.Numeric(),
				name: t.String()
			})
		)
	})

	it('replace object properties in nullable', async () => {
		expect(
			replaceSchemaType(
				t.Nullable(
					t.Object({
						id: t.Number(),
						name: t.String()
					})
				),
				{
					from: t.Number(),
					to: () => t.Numeric()
				}
			)
		).toMatchObject(
			t.Nullable(
				t.Object({
					id: t.Numeric(),
					name: t.String()
				})
			)
		)
	})

	it('replace object properties in Union', async () => {
		expect(
			replaceSchemaType(
				t.Union([
					t.String(),
					t.Object({
						id: t.Number(),
						name: t.String()
					})
				]),
				{
					from: t.Number(),
					to: () => t.Numeric()
				}
			)
		).toMatchObject(
			t.Union([
				t.String(),
				t.Object({
					id: t.Numeric(),
					name: t.String()
				})
			])
		)
	})

	it('maintain descriptive properties', async () => {
		expect(
			replaceSchemaType(
				t.Object({
					id: t.Number({
						default: 1,
						title: 'hello'
					}),
					name: t.String()
				}),
				{
					from: t.Number(),
					to: () => t.Numeric()
				}
			)
		).toMatchObject(
			t.Object({
				id: t.Numeric({
					default: 1,
					title: 'hello'
				}),
				name: t.String()
			})
		)
	})

	it('accept multiple replacement', async () => {
		expect(
			replaceSchemaType(
				t.Object({
					id: t.Number(),
					isAdmin: t.Boolean()
				}),
				[
					{
						from: t.Number(),
						to: () => t.Numeric()
					},
					{
						from: t.Boolean(),
						to: () => t.BooleanString()
					}
				]
			)
		).toMatchObject(
			t.Object({
				id: t.Numeric(),
				isAdmin: t.BooleanString()
			})
		)
	})

	it('replace excludeRoot (match ObjectString)', () => {
		expect(
			replaceSchemaType(
				t.Object({
					obj: t.Object({
						id: t.String()
					})
				}),
				{
					from: t.Object({}),
					to: () => t.ObjectString({}),
					excludeRoot: true,
					untilObjectFound: false
				}
			)
		).toMatchObject(
			t.Object({
				obj: t.ObjectString({
					id: t.String()
				})
			})
		)
	})

	it('replace replace ArrayString', () => {
		expect(
			replaceSchemaType(
				t.Object({
					arr: t.Array(t.String())
				}),
				{
					from: t.Object({}),
					to: () => t.ObjectString({}),
					excludeRoot: true
				}
			)
		).toMatchObject(
			t.Object({
				arr: t.Array(t.String())
			})
		)
	})

	it('replace re-calculate transform', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				pagination: t.Object({
					pageIndex: t.Number(),
					pageLimit: t.Number()
				})
			})
		})

		const status = await app
			.handle(req('/?pagination={"pageIndex":1}'))
			.then((x) => x.status)

		expect(status).toBe(422)
	})

	it('replace item in Array', () => {
		expect(
			replaceSchemaType(
				t.Object({
					arr: t.Array(t.Number())
				}),
				{
					from: t.Number(),
					to: () => t.Numeric(),
					excludeRoot: true
				}
			)
		).toMatchObject(
			t.Object({
				arr: t.Array(t.Numeric())
			})
		)
	})
})
