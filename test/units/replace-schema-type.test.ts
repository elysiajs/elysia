import { describe, it, expect } from 'bun:test'
import { t } from '../../src'
import { replaceSchemaType } from '../../src/utils'

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
})
