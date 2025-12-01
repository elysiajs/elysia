import { describe, it, expect } from 'bun:test'
import type { TSchema } from '@sinclair/typebox'
import { Elysia, t } from '../../src'
import {
	replaceSchemaTypeFromManyOptions as replaceSchemaType,
	revertObjAndArrStr,
	coerceFormData
} from '../../src/replace-schema'
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
					to: (options) => t.Numeric(options)
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
					to: (schema) => t.ObjectString(schema.properties),
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

	describe('Basic Transformation', () => {
		it('should transform Object to ObjectString', () => {
			expect(
				replaceSchemaType(
					t.Object({
						name: t.String()
					}),
					{
						from: t.Object({}),
						to: (s) => t.ObjectString(s.properties || {}, s)
					}
				)
			).toMatchObject({
				elysiaMeta: 'ObjectString'
			})
		})

		it('should transform Array to ArrayString', () => {
			expect(
				replaceSchemaType(t.Array(t.String()), {
					from: t.Array(t.Any()),
					to: (s) => t.ArrayString(s.items || t.Any(), s)
				})
			).toMatchObject({
				elysiaMeta: 'ArrayString'
			})
		})

		it('should preserve properties after transformation', () => {
			expect(
				replaceSchemaType(
					t.Object({
						name: t.String(),
						age: t.Number()
					}),
					{
						from: t.Object({}),
						to: (s) => t.ObjectString(s.properties || {}, s)
					}
				)
			).toMatchObject(
				t.ObjectString({
					name: t.String(),
					age: t.Number()
				})
			)
		})
	})

	describe('excludeRoot Option', () => {
		it('should NOT transform root when excludeRoot is true', () => {
			const result = replaceSchemaType(
				t.Object({
					metadata: t.Object({
						category: t.String()
					})
				}),
				{
					from: t.Object({}),
					to: (s) => t.ObjectString(s.properties || {}, s),
					excludeRoot: true
				}
			)

			expect(result).toMatchObject({
				type: 'object'
			})
			expect(result.elysiaMeta).toBeUndefined()
			expect(result.properties.metadata).toMatchObject({
				elysiaMeta: 'ObjectString'
			})
		})

		it('should transform root when excludeRoot is false', () => {
			expect(
				replaceSchemaType(
					t.Object({
						name: t.String()
					}),
					{
						from: t.Object({}),
						to: (s) => t.ObjectString(s.properties || {}, s),
						excludeRoot: false
					}
				)
			).toMatchObject({
				elysiaMeta: 'ObjectString'
			})
		})
	})

	describe('onlyFirst Option', () => {
		it('should stop traversal after first match', () => {
			const result = replaceSchemaType(
				t.Object({
					level1: t.Object({
						level2: t.Object({
							level3: t.String()
						})
					})
				}),
				{
					from: t.Object({}),
					to: (s) => t.ObjectString(s.properties || {}, s),
					onlyFirst: 'object',
					excludeRoot: true
				}
			)

			expect(result.properties.level1).toMatchObject({
				elysiaMeta: 'ObjectString'
			})

			const level1ObjBranch = result.properties.level1.anyOf.find(
				(x: TSchema) => x.type === 'object'
			)
			expect(level1ObjBranch.properties.level2).toMatchObject({
				type: 'object'
			})
			expect(level1ObjBranch.properties.level2.elysiaMeta).toBeUndefined()
		})

		it('should transform all siblings at same level', () => {
			const result = replaceSchemaType(
				t.Object({
					obj1: t.Object({ a: t.String() }),
					obj2: t.Object({ b: t.String() }),
					str: t.String()
				}),
				{
					from: t.Object({}),
					to: (s) => t.ObjectString(s.properties || {}, s),
					onlyFirst: 'object',
					excludeRoot: true
				}
			)

			expect(result.properties.obj1).toMatchObject({
				elysiaMeta: 'ObjectString'
			})
			expect(result.properties.obj2).toMatchObject({
				elysiaMeta: 'ObjectString'
			})
			expect(result.properties.str).toMatchObject({
				type: 'string'
			})
		})
	})

	describe('rootOnly Option', () => {
		it('should only transform root, not children', () => {
			const result = replaceSchemaType(
				t.Object({
					nested: t.Object({
						deep: t.String()
					})
				}),
				{
					from: t.Object({}),
					to: (s) => t.ObjectString(s.properties || {}, s),
					rootOnly: true
				}
			)

			expect(result).toMatchObject({
				elysiaMeta: 'ObjectString'
			})

			const objBranch = result.anyOf.find(
				(x: TSchema) => x.type === 'object'
			)
			expect(objBranch.properties.nested).toMatchObject({
				type: 'object'
			})
			expect(objBranch.properties.nested.elysiaMeta).toBeUndefined()
		})

		it('should not transform if root does not match', () => {
			expect(
				replaceSchemaType(t.String(), {
					from: t.Object({}),
					to: (s) => t.ObjectString(s.properties || {}, s),
					rootOnly: true
				})
			).toMatchObject({
				type: 'string'
			})
		})
	})

	describe('Double-wrapping Protection', () => {
		it('should NOT double-wrap ObjectString', () => {
			const result = replaceSchemaType(
				t.Object({
					metadata: t.ObjectString({
						category: t.String()
					})
				}),
				{
					from: t.Object({}),
					to: (s) => t.ObjectString(s.properties || {}, s),
					excludeRoot: true
				}
			)

			expect(result.properties.metadata).toMatchObject({
				elysiaMeta: 'ObjectString'
			})

			const anyOf = result.properties.metadata.anyOf
			const objBranch = anyOf.find((x: TSchema) => x.type === 'object')
			expect(objBranch.elysiaMeta).toBeUndefined()
			expect(objBranch.anyOf).toBeUndefined()
		})

		it('should NOT double-wrap ArrayString', () => {
			const result = replaceSchemaType(
				t.Object({
					items: t.ArrayString(t.String())
				}),
				{
					from: t.Array(t.Any()),
					to: (s) => t.ArrayString(s.items || t.Any(), s),
					excludeRoot: true
				}
			)

			expect(result.properties.items).toMatchObject({
				elysiaMeta: 'ArrayString'
			})

			const anyOf = result.properties.items.anyOf
			const arrBranch = anyOf.find((x: TSchema) => x.type === 'array')
			expect(arrBranch.elysiaMeta).toBeUndefined()
		})
	})

	describe('Bottom-up Traversal', () => {
		it('should transform children before parents', () => {
			const result = replaceSchemaType(
				t.Object({
					level1: t.Object({
						level2: t.Object({
							level3: t.String()
						})
					})
				}),
				{
					from: t.Object({}),
					to: (s) => t.ObjectString(s.properties || {}, s),
					excludeRoot: true
				}
			)

			expect(result.properties.level1).toMatchObject({
				elysiaMeta: 'ObjectString'
			})

			const level1ObjBranch = result.properties.level1.anyOf.find(
				(x: TSchema) => x.type === 'object'
			)
			expect(level1ObjBranch.properties.level2).toMatchObject({
				elysiaMeta: 'ObjectString'
			})
		})
	})

	describe('Array of Options', () => {
		it('should apply multiple transformations in order', () => {
			const result = replaceSchemaType(
				t.Object({
					metadata: t.Object({
						category: t.String()
					}),
					tags: t.Array(t.String())
				}),
				[
					{
						from: t.Object({}),
						to: (s) => t.ObjectString(s.properties || {}, s),
						excludeRoot: true
					},
					{
						from: t.Array(t.Any()),
						to: (s) => t.ArrayString(s.items || t.Any(), s),
						excludeRoot: true
					}
				]
			)

			expect(result.properties.metadata).toMatchObject({
				elysiaMeta: 'ObjectString'
			})
			expect(result.properties.tags).toMatchObject({
				elysiaMeta: 'ArrayString'
			})
		})
	})

	describe('Composition Types', () => {
		it('should traverse anyOf branches', () => {
			const result = replaceSchemaType(
				{
					anyOf: [
						t.Object({ a: t.String() }),
						t.Object({ b: t.Number() })
					]
				} as any,
				{
					from: t.Object({}),
					to: (s) => t.ObjectString(s.properties || {}, s)
				}
			)

			expect(result.anyOf[0]).toMatchObject({
				elysiaMeta: 'ObjectString'
			})
			expect(result.anyOf[1]).toMatchObject({
				elysiaMeta: 'ObjectString'
			})
		})

		it('should traverse oneOf branches', () => {
			const result = replaceSchemaType(
				{
					oneOf: [t.Object({ type: t.String() }), t.Array(t.String())]
				} as any,
				{
					from: t.Object({}),
					to: (s) => t.ObjectString(s.properties || {}, s)
				}
			)

			expect(result.oneOf[0]).toMatchObject({
				elysiaMeta: 'ObjectString'
			})
			expect(result.oneOf[1]).toMatchObject({
				type: 'array'
			})
		})
	})

	describe('Reverse Transformation Helpers', () => {
		it('should extract plain Object from ObjectString', () => {
			const objectString = t.ObjectString({
				name: t.String(),
				age: t.Number()
			})

			const result = revertObjAndArrStr(objectString)

			expect(result).toMatchObject({
				type: 'object'
			})
			expect(result.elysiaMeta).toBeUndefined()
			expect(result.anyOf).toBeUndefined()
			expect(result.properties).toMatchObject({
				name: { type: 'string' },
				age: { type: 'number' }
			})
		})

		it('should return unchanged if not ObjectString', () => {
			const plainObject = t.Object({
				name: t.String()
			})

			const result = revertObjAndArrStr(plainObject)

			expect(result).toBe(plainObject)
		})

		it('should extract plain Array from ArrayString', () => {
			const arrayString = t.ArrayString(t.String())

			const result = revertObjAndArrStr(arrayString)

			expect(result).toMatchObject({
				type: 'array'
			})
			expect(result.elysiaMeta).toBeUndefined()
			expect(result.anyOf).toBeUndefined()
			expect(result.items).toMatchObject({
				type: 'string'
			})
		})

		it('should return unchanged if not ArrayString', () => {
			const plainArray = t.Array(t.String())

			const result = revertObjAndArrStr(plainArray)

			expect(result).toBe(plainArray)
		})

		it('should transform ObjectString back to Object', () => {
			const result = replaceSchemaType(
				t.Object({
					metadata: t.ObjectString({
						category: t.String()
					})
				}),
				{
					from: t.ObjectString({}),
					to: (s) => revertObjAndArrStr(s),
					excludeRoot: true
				}
			)

			expect(result.properties.metadata).toMatchObject({
				type: 'object'
			})
			expect(result.properties.metadata.elysiaMeta).toBeUndefined()
			expect(result.properties.metadata.anyOf).toBeUndefined()
			expect(result.properties.metadata.properties.category).toMatchObject(
				{
					type: 'string'
				}
			)
		})

		it('should transform ArrayString back to Array', () => {
			const result = replaceSchemaType(
				t.Object({
					tags: t.ArrayString(t.String())
				}),
				{
					from: t.ArrayString(t.Any()),
					to: (s) => revertObjAndArrStr(s),
					excludeRoot: true
				}
			)

			expect(result.properties.tags).toMatchObject({
				type: 'array'
			})
			expect(result.properties.tags.elysiaMeta).toBeUndefined()
			expect(result.properties.tags.anyOf).toBeUndefined()
		})
	})

	describe('coerceFormData', () => {
		it('should convert first-level Object to ObjectString (excluding root)', () => {
			const result = replaceSchemaType(
				t.Object({
					user: t.Object({
						name: t.String(),
						age: t.Number()
					})
				}),
				coerceFormData()
			)

			// Root should remain plain Object
			expect(result).toMatchObject({
				type: 'object'
			})
			expect(result.elysiaMeta).toBeUndefined()

			// First-level nested object should be converted to ObjectString
			expect(result.properties.user).toMatchObject({
				elysiaMeta: 'ObjectString'
			})
		})

		it('should NOT convert deeper nested Objects', () => {
			const result = replaceSchemaType(
				t.Object({
					level1: t.Object({
						level2: t.Object({
							level3: t.Object({
								value: t.String()
							})
						})
					})
				}),
				coerceFormData()
			)

			// level1 should be ObjectString
			expect(result.properties.level1).toMatchObject({
				elysiaMeta: 'ObjectString'
			})

			// level2 should remain plain Object (not converted)
			const level1ObjBranch = result.properties.level1.anyOf.find(
				(x: TSchema) => x.type === 'object'
			)
			expect(level1ObjBranch.properties.level2).toMatchObject({
				type: 'object'
			})
			expect(level1ObjBranch.properties.level2.elysiaMeta).toBeUndefined()

			// level3 should also remain plain Object
			expect(level1ObjBranch.properties.level2.properties.level3).toMatchObject({
				type: 'object'
			})
			expect(level1ObjBranch.properties.level2.properties.level3.elysiaMeta).toBeUndefined()
		})

		it('should convert first-level Array to ArrayString', () => {
			const result = replaceSchemaType(
				t.Object({
					tags: t.Array(t.String())
				}),
				coerceFormData()
			)

			// tags should be converted to ArrayString
			expect(result.properties.tags).toMatchObject({
				elysiaMeta: 'ArrayString'
			})
		})

		it('should NOT convert deeper nested Arrays', () => {
			const result = replaceSchemaType(
				t.Object({
					level1: t.Array(
						t.Array(
							t.Array(t.String())
						)
					)
				}),
				coerceFormData()
			)

			// First-level array should be ArrayString
			expect(result.properties.level1).toMatchObject({
				elysiaMeta: 'ArrayString'
			})

			// Second-level array should remain plain Array
			const level1ArrBranch = result.properties.level1.anyOf.find(
				(x: TSchema) => x.type === 'array'
			)
			expect(level1ArrBranch.items).toMatchObject({
				type: 'array'
			})
			expect(level1ArrBranch.items.elysiaMeta).toBeUndefined()

			// Third-level array should also remain plain Array
			expect(level1ArrBranch.items.items).toMatchObject({
				type: 'array'
			})
			expect(level1ArrBranch.items.items.elysiaMeta).toBeUndefined()
		})

		it('should handle Object with File and nested Object', () => {
			const result = replaceSchemaType(
				t.Object({
					avatar: t.File(),
					metadata: t.Object({
						tags: t.Array(t.String()),
						settings: t.Object({
							theme: t.String()
						})
					})
				}),
				coerceFormData()
			)

			// Root should remain Object
			expect(result.type).toBe('object')
			expect(result.elysiaMeta).toBeUndefined()

			// File should remain as File
			expect(result.properties.avatar).toMatchObject({
				type: 'string',
				format: 'binary'
			})

			// First-level metadata should be ObjectString
			expect(result.properties.metadata).toMatchObject({
				elysiaMeta: 'ObjectString'
			})

			// Nested tags array should remain plain Array (not converted)
			const metadataObjBranch = result.properties.metadata.anyOf.find(
				(x: TSchema) => x.type === 'object'
			)
			expect(metadataObjBranch.properties.tags).toMatchObject({
				type: 'array'
			})
			expect(metadataObjBranch.properties.tags.elysiaMeta).toBeUndefined()

			// Nested settings object should remain plain Object (not converted)
			expect(metadataObjBranch.properties.settings).toMatchObject({
				type: 'object'
			})
			expect(metadataObjBranch.properties.settings.elysiaMeta).toBeUndefined()
		})

		it('should handle Object with Files (array) and nested structures', () => {
			const result = replaceSchemaType(
				t.Object({
					images: t.Files(),
					data: t.Object({
						items: t.Array(
							t.Object({
								name: t.String()
							})
						)
					})
				}),
				coerceFormData()
			)

			// Files should remain as Files
			expect(result.properties.images).toMatchObject({
				type: 'array',
				items: {
					type: 'string',
					format: 'binary'
				},
				elysiaMeta: 'Files'
			})

			// First-level data should be ObjectString
			expect(result.properties.data).toMatchObject({
				elysiaMeta: 'ObjectString'
			})

			// Nested items array should remain plain Array
			const dataObjBranch = result.properties.data.anyOf.find(
				(x: TSchema) => x.type === 'object'
			)
			expect(dataObjBranch.properties.items).toMatchObject({
				type: 'array'
			})
			expect(dataObjBranch.properties.items.elysiaMeta).toBeUndefined()

			// Array items (objects) should remain plain Objects
			expect(dataObjBranch.properties.items.items).toMatchObject({
				type: 'object'
			})
			expect(dataObjBranch.properties.items.items.elysiaMeta).toBeUndefined()
		})

		it('should convert all first-level siblings', () => {
			const result = replaceSchemaType(
				t.Object({
					obj1: t.Object({ a: t.String() }),
					obj2: t.Object({ b: t.Number() }),
					arr1: t.Array(t.String()),
					arr2: t.Array(t.Number()),
					file: t.File(),
					str: t.String()
				}),
				coerceFormData()
			)

			// All first-level objects should be ObjectString
			expect(result.properties.obj1).toMatchObject({
				elysiaMeta: 'ObjectString'
			})
			expect(result.properties.obj2).toMatchObject({
				elysiaMeta: 'ObjectString'
			})

			// All first-level arrays should be ArrayString
			expect(result.properties.arr1).toMatchObject({
				elysiaMeta: 'ArrayString'
			})
			expect(result.properties.arr2).toMatchObject({
				elysiaMeta: 'ArrayString'
			})

			// Other types should remain unchanged
			expect(result.properties.file).toMatchObject({
				type: 'string',
				format: 'binary'
			})
			expect(result.properties.str).toMatchObject({
				type: 'string'
			})
		})

		it('should handle mixed nested structures correctly', () => {
			const result = replaceSchemaType(
				t.Object({
					upload: t.File(),
					config: t.Object({
						nested: t.Object({
							deep: t.Array(
								t.Object({
									value: t.String()
								})
							)
						})
					})
				}),
				coerceFormData()
			)

			// config should be ObjectString
			expect(result.properties.config).toMatchObject({
				elysiaMeta: 'ObjectString'
			})

			const configObjBranch = result.properties.config.anyOf.find(
				(x: TSchema) => x.type === 'object'
			)

			// nested should remain plain Object
			expect(configObjBranch.properties.nested).toMatchObject({
				type: 'object'
			})
			expect(configObjBranch.properties.nested.elysiaMeta).toBeUndefined()

			// deep array should remain plain Array
			expect(configObjBranch.properties.nested.properties.deep).toMatchObject({
				type: 'array'
			})
			expect(configObjBranch.properties.nested.properties.deep.elysiaMeta).toBeUndefined()

			// Array items should remain plain Objects
			expect(configObjBranch.properties.nested.properties.deep.items).toMatchObject({
				type: 'object'
			})
			expect(configObjBranch.properties.nested.properties.deep.items.elysiaMeta).toBeUndefined()
		})
	})
})
