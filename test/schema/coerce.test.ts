import Type from 'typebox'
import { coerce } from '../../src/type/coerce'
import { type BaseSchema } from '../../src/type'
import { describe, expect, it } from 'bun:test'

describe('coerce schema', () => {
	it('transforms a matching nested schema', () => {
		const schema = Type.Object({
			name: Type.String()
		})

		const transformedSchema = coerce(schema, [
			['String', (properties) => Type.Number(properties)]
		])

		expect(transformedSchema.type).toBe('object')
		expect(transformedSchema.required).toEqual(['name'])
		expect(transformedSchema.properties?.name?.type).toBe('number')

		expect(transformedSchema['~kind']).toBe('Object')
		expect(transformedSchema.properties?.name?.['~kind']).toBe('Number')
	})

	describe('root: true option', () => {
		it('should replace only root-level match', () => {
			const schema = Type.String()

			const result = coerce(schema, [['String', () => Type.Number()]], {
				root: true
			})

			expect(result['~kind']).toBe('Number')
		})

		it('should NOT replace nested matches when root: true', () => {
			const schema = Type.Object({
				name: Type.String()
			})

			const result = coerce(schema, [['String', () => Type.Number()]], {
				root: true
			})

			expect(result['~kind']).toBe('Object')
			expect(result.properties?.name?.['~kind']).toBe('String')
		})

		it('should replace root when it matches', () => {
			const schema = Type.Object({
				name: Type.String()
			})

			const result = coerce(
				schema,
				[
					[
						'Object',
						(s) =>
							({
								...s,
								'~kind': 'Object',
								description: 'replaced'
							}) as BaseSchema
					]
				],
				{ root: true }
			)

			expect(result['~kind']).toBe('Object')
			expect((result as any).description).toBe('replaced')
		})
	})

	describe('root: false option', () => {
		it('should NOT replace root-level match', () => {
			const schema = Type.String()

			const result = coerce(schema, [['String', () => Type.Number()]], {
				root: false
			})

			expect(result['~kind']).toBe('String')
		})

		it('should replace only non-root matches', () => {
			const schema = Type.Object({
				name: Type.String()
			})

			const result = coerce(schema, [['String', () => Type.Number()]], {
				root: false
			})

			expect(result['~kind']).toBe('Object')
			expect(result.properties?.name?.['~kind']).toBe('Number')
		})

		it('should NOT replace root Object but still traverse into it', () => {
			const schema = Type.Object({
				count: Type.Number()
			})

			const result = coerce(
				schema,
				[
					['Object', () => Type.String()],
					['Number', () => Type.Boolean()]
				],
				{ root: false }
			)

			expect(result['~kind']).toBe('Object')
			expect(result.properties?.count?.['~kind']).toBe('Boolean')
		})
	})

	describe('onlyFirst option', () => {
		it('should stop traversal after first match of specified kind', () => {
			const schema = Type.Object({
				a: Type.String(),
				b: Type.String(),
				c: Type.String()
			})

			let callCount = 0
			const result = coerce(
				schema,
				[
					[
						'String',
						() => {
							callCount++
							return Type.Number()
						}
					]
				],
				{ onlyFirst: 'String' }
			)

			expect(callCount).toBe(1)

			const props = result.properties!
			const kinds = Object.values(props).map((p) => p['~kind'])
			const numberCount = kinds.filter((k) => k === 'Number').length
			const stringCount = kinds.filter((k) => k === 'String').length

			expect(numberCount).toBe(1)
			expect(stringCount).toBe(2)
		})

		it('should not replace subsequent matches of the same kind', () => {
			const schema = Type.Object({
				first: Type.String(),
				second: Type.String()
			})

			const result = coerce(schema, [['String', () => Type.Number()]], {
				onlyFirst: 'String'
			})

			const props = result.properties!
			const kinds = Object.values(props).map((p) => p['~kind'])
			expect(kinds.filter((k) => k === 'Number').length).toBe(1)
			expect(kinds.filter((k) => k === 'String').length).toBe(1)
		})
	})

	describe('untilNonRootObjectFound option', () => {
		it('should skip non-root Object entirely', () => {
			const schema = Type.Object({
				nested: Type.Object({
					deep: Type.String()
				})
			})

			const result = coerce(schema, [['String', () => Type.Number()]], {
				untilNonRootObjectFound: true
			})

			expect(result['~kind']).toBe('Object')
			expect(result.properties?.nested?.['~kind']).toBe('Object')
			expect(result.properties?.nested?.properties?.deep?.['~kind']).toBe(
				'String'
			)
		})

		it('should skip non-root Array entirely', () => {
			const schema = Type.Object({
				items: Type.Array(Type.String())
			})

			const result = coerce(schema, [['String', () => Type.Number()]], {
				untilNonRootObjectFound: true
			})

			expect(result['~kind']).toBe('Object')
			expect(result.properties?.items?.['~kind']).toBe('Array')
			expect(
				(result.properties?.items?.items as BaseSchema)?.['~kind']
			).toBe('String')
		})

		it('should still process root Object properties at first level', () => {
			const schema = Type.Object({
				name: Type.String()
			})

			const result = coerce(schema, [['String', () => Type.Number()]], {
				untilNonRootObjectFound: true
			})

			expect(result['~kind']).toBe('Object')
			expect(result.properties?.name?.['~kind']).toBe('Number')
		})

		it('should process root Array items', () => {
			const schema = Type.Array(Type.String())

			const result = coerce(schema, [['String', () => Type.Number()]], {
				untilNonRootObjectFound: true
			})

			expect(result['~kind']).toBe('Array')
			expect((result.items as BaseSchema)?.['~kind']).toBe('Number')
		})
	})

	describe('to returning null', () => {
		it('should skip replacement when to returns null', () => {
			const schema = Type.Object({
				name: Type.String()
			})

			const result = coerce(schema, [['String', () => null]])

			expect(result.properties?.name?.['~kind']).toBe('String')
		})

		it('should keep original schema unchanged when to returns null', () => {
			const original = Type.String()
			const result = coerce(original, [['String', () => null]])

			expect(result).toBe(original)
		})

		it('should break and not try subsequent fromTo entries after null', () => {
			const schema = Type.String()

			let secondCalled = false
			const result = coerce(schema, [
				['String', () => null],
				[
					'String',
					() => {
						secondCalled = true
						return Type.Number()
					}
				]
			])

			expect(secondCalled).toBe(false)
			expect(result['~kind']).toBe('String')
		})
	})

	describe('structural sharing', () => {
		it('should return same reference for unchanged subtrees', () => {
			const innerString = Type.String()
			const innerNumber = Type.Number()
			const schema = Type.Object({
				str: innerString,
				num: innerNumber
			})

			const result = coerce(schema, [['String', () => Type.Boolean()]])

			expect(result.properties?.num).toBe(innerNumber)
			expect(result.properties?.str).not.toBe(innerString)
			expect(result.properties?.str?.['~kind']).toBe('Boolean')
		})

		it('should only shallow-copy changed nodes', () => {
			const deepNested = Type.Object({
				value: Type.Number()
			})
			const schema = Type.Object({
				unchanged: deepNested,
				changed: Type.String()
			})

			const result = coerce(schema, [['String', () => Type.Boolean()]])

			expect(result.properties?.unchanged).toBe(deepNested)
			expect(result).not.toBe(schema)
		})

		it('should return same array reference if no items changed', () => {
			const schema = Type.Object({
				names: Type.Array(Type.Number())
			})

			const result = coerce(schema, [['String', () => Type.Boolean()]])

			expect(result.properties?.names).toBe(schema.properties?.names)
		})
	})

	describe('combinator traversal', () => {
		it('should traverse and transform schemas in anyOf array', () => {
			const schema = Type.Union([Type.String(), Type.Number()])

			const result = coerce(schema, [['String', () => Type.Boolean()]])

			expect(result.anyOf?.[0]?.['~kind']).toBe('Boolean')
			expect(result.anyOf?.[1]?.['~kind']).toBe('Number')
		})

		it('should traverse and transform schemas in a synthetic oneOf array', () => {
			const schema = {
				'~kind': 'Union',
				oneOf: [Type.String(), Type.String()]
			} as BaseSchema

			const result = coerce(schema, [['String', () => Type.Number()]])

			expect(result.oneOf?.[0]?.['~kind']).toBe('Number')
			expect(result.oneOf?.[1]?.['~kind']).toBe('Number')
		})

		it('should traverse and transform schemas in allOf array', () => {
			const schema = Type.Intersect([
				Type.Object({ a: Type.String() }),
				Type.Object({ b: Type.Number() })
			])

			const result = coerce(schema, [['String', () => Type.Boolean()]])

			expect(result.allOf?.[0]?.properties?.a?.['~kind']).toBe('Boolean')
			expect(result.allOf?.[1]?.properties?.b?.['~kind']).toBe('Number')
		})

		it('should preserve structural sharing in combinators', () => {
			const unchangedSchema = Type.Number()
			const schema = Type.Union([Type.String(), unchangedSchema])

			const result = coerce(schema, [['String', () => Type.Boolean()]])

			expect(result.anyOf?.[1]).toBe(unchangedSchema)
		})
	})

	describe('nested objects/arrays', () => {
		it('should traverse deeply nested object properties', () => {
			const schema = Type.Object({
				level1: Type.Object({
					level2: Type.Object({
						level3: Type.String()
					})
				})
			})

			const result = coerce(schema, [['String', () => Type.Number()]])

			expect(
				result.properties?.level1?.properties?.level2?.properties
					?.level3?.['~kind']
			).toBe('Number')
		})

		it('should traverse array items (single schema)', () => {
			const schema = Type.Array(Type.String())

			const result = coerce(schema, [['String', () => Type.Number()]])

			expect(result['~kind']).toBe('Array')
			expect((result.items as BaseSchema)?.['~kind']).toBe('Number')
		})

		it('should traverse tuple items (array of schemas)', () => {
			const schema = Type.Tuple([
				Type.String(),
				Type.Number(),
				Type.Boolean()
			])

			const result = coerce(schema, [['String', () => Type.Integer()]])

			expect(result['~kind']).toBe('Tuple')
			const items = result.items as BaseSchema[]
			expect(items[0]?.['~kind']).toBe('Integer')
			expect(items[1]?.['~kind']).toBe('Number')
			expect(items[2]?.['~kind']).toBe('Boolean')
		})

		it('should traverse array of objects', () => {
			const schema = Type.Array(
				Type.Object({
					name: Type.String()
				})
			)

			const result = coerce(schema, [['String', () => Type.Number()]])

			const itemSchema = result.items as BaseSchema
			expect(itemSchema.properties?.name?.['~kind']).toBe('Number')
		})
	})

	describe('patternProperties (Record)', () => {
		it('should traverse and transform schemas in patternProperties', () => {
			const schema = Type.Record(Type.String(), Type.String())

			const result = coerce(schema, [['String', () => Type.Number()]])

			const patternKeys = Object.keys(result.patternProperties || {})
			expect(patternKeys.length).toBeGreaterThan(0)

			const patternValue = result.patternProperties?.[patternKeys[0]!]
			expect(patternValue?.['~kind']).toBe('Number')
		})

		it('should preserve unchanged patternProperties', () => {
			const schema = Type.Record(Type.String(), Type.Number())

			const result = coerce(schema, [['Boolean', () => Type.String()]])

			expect(result.patternProperties).toBe(schema.patternProperties)
		})
	})

	describe('additionalProperties', () => {
		it('should traverse and transform additionalProperties when it is a schema object', () => {
			const schema = Type.Object(
				{},
				{ additionalProperties: Type.String() }
			)

			const result = coerce(schema, [['String', () => Type.Number()]])

			expect(result.additionalProperties).toBeDefined()
			expect((result.additionalProperties as BaseSchema)['~kind']).toBe(
				'Number'
			)
		})

		it('should ignore additionalProperties when it is a boolean', () => {
			const schema = Type.Object(
				{},
				{
					additionalProperties: true
				}
			)

			const result = coerce(schema, [['String', () => Type.Number()]])

			expect(result.additionalProperties).toBe(true)
		})

		it('should preserve additionalProperties reference when unchanged', () => {
			const additionalSchema = Type.Number()
			const schema = Type.Object(
				{},
				{ additionalProperties: additionalSchema }
			)

			const result = coerce(schema, [['String', () => Type.Boolean()]])

			expect(result.additionalProperties).toBe(additionalSchema)
		})
	})

	describe('cyclic schema unwrap', () => {
		it('should only unwrap the $ref target in $defs', () => {
			const schema = {
				'~kind': 'Cyclic',
				$ref: 'Node',
				$defs: {
					Node: Type.Object({
						value: Type.String()
					}),
					Other: Type.Object({
						other: Type.String()
					})
				}
			} as BaseSchema

			const result = coerce(schema, [['String', () => Type.Number()]])

			expect(result.$defs?.Node?.properties?.value?.['~kind']).toBe(
				'Number'
			)
			expect(result.$defs?.Other).toBe(schema.$defs?.Other)
		})

		it('should not walk entire $defs map', () => {
			let walkCount = 0
			const schema = {
				'~kind': 'Cyclic',
				$ref: 'A',
				$defs: {
					A: Type.String(),
					B: Type.String(),
					C: Type.String()
				}
			} as BaseSchema

			coerce(schema, [
				[
					'String',
					(s) => {
						walkCount++
						return Type.Number()
					}
				]
			])

			expect(walkCount).toBe(1)
		})
	})

	describe('no-op returns same reference', () => {
		it('should return exact same object reference when no transformations match', () => {
			const schema = Type.Object({
				name: Type.String(),
				age: Type.Number()
			})

			const result = coerce(schema, [['Boolean', () => Type.Integer()]])

			expect(result).toBe(schema)
		})

		it('should return same reference for nested unchanged schemas', () => {
			const nested = Type.Object({
				value: Type.Number()
			})
			const schema = Type.Object({
				nested
			})

			const result = coerce(schema, [['Boolean', () => Type.String()]])

			expect(result).toBe(schema)
			expect(result.properties?.nested).toBe(nested)
		})

		it('should return same array items reference when no items change', () => {
			const itemSchema = Type.Number()
			const schema = Type.Array(itemSchema)

			const result = coerce(schema, [['String', () => Type.Boolean()]])

			expect(result).toBe(schema)
			expect(result.items).toBe(itemSchema)
		})
	})

	describe('not combinator', () => {
		it('should traverse and transform schema in not', () => {
			const schema = {
				'~kind': 'Not',
				not: Type.String()
			} as BaseSchema

			const result = coerce(schema, [['String', () => Type.Number()]])

			expect(result.not?.['~kind']).toBe('Number')
		})

		it('should preserve not reference when unchanged', () => {
			const innerSchema = Type.Number()
			const schema = {
				'~kind': 'Not',
				not: innerSchema
			} as BaseSchema

			const result = coerce(schema, [['String', () => Type.Boolean()]])

			expect(result.not).toBe(innerSchema)
		})
	})

	describe('first match wins', () => {
		it('should use the first matching fromTo entry', () => {
			const schema = Type.String()

			const result = coerce(schema, [
				['String', () => Type.Number()],
				['String', () => Type.Boolean()]
			])

			expect(result['~kind']).toBe('Number')
		})
	})

	describe('cycle guard', () => {
		it('should handle self-referencing seen nodes', () => {
			const schema = Type.Object({
				name: Type.String()
			}) as any

			schema.properties.self = schema

			const result = coerce(schema, [['String', () => Type.Number()]])

			expect(result['~kind']).toBe('Object')
			expect(result.properties?.name?.['~kind']).toBe('Number')
			expect(result.properties?.self).toBe(schema)
		})
	})

	describe('empty fromTo array', () => {
		it('should return original schema reference when fromTo is empty', () => {
			const schema = Type.Object({ name: Type.String() })
			const result = coerce(schema, [])
			expect(result).toBe(schema)
		})
	})

	describe('schema without ~kind', () => {
		it('should traverse but not replace nodes without ~kind', () => {
			const schema = {
				type: 'object',
				properties: { name: Type.String() }
			} as BaseSchema

			const result = coerce(schema, [['String', () => Type.Number()]])
			expect(result.properties?.name?.['~kind']).toBe('Number')
		})

		it('should handle completely plain object with no ~kind at any level', () => {
			const schema = {
				type: 'object',
				properties: { name: { type: 'string' } }
			} as any

			const result = coerce(schema, [['String', () => Type.Number()]])
			expect(result.properties?.name?.type).toBe('string')
		})
	})

	describe('to callback behavior', () => {
		it('should receive schema copy with type property deleted', () => {
			const schema = Type.String()
			let receivedSchema: any

			coerce(schema, [
				[
					'String',
					(s) => {
						receivedSchema = s
						return Type.Number()
					}
				]
			])

			expect(receivedSchema.type).toBeUndefined()
			expect(receivedSchema['~kind']).toBeUndefined()
		})

		it('should preserve other properties in callback', () => {
			const schema = Type.String({ minLength: 5, description: 'test' })
			let receivedSchema: any

			coerce(schema, [
				[
					'String',
					(s) => {
						receivedSchema = s
						return Type.Number()
					}
				]
			])

			expect(receivedSchema.minLength).toBe(5)
			expect(receivedSchema.description).toBe('test')
		})
	})

	describe('multiple combinators', () => {
		it('should traverse both anyOf and allOf on same node', () => {
			const schema = {
				'~kind': 'Complex',
				anyOf: [Type.String()],
				allOf: [Type.Object({ a: Type.String() })]
			} as BaseSchema

			const result = coerce(schema, [['String', () => Type.Number()]])

			expect(result.anyOf?.[0]?.['~kind']).toBe('Number')
			expect(result.allOf?.[0]?.properties?.a?.['~kind']).toBe('Number')
		})

		it('should traverse anyOf, oneOf, and allOf together', () => {
			const schema = {
				'~kind': 'Complex',
				anyOf: [Type.String()],
				oneOf: [Type.String()],
				allOf: [Type.String()]
			} as BaseSchema

			const result = coerce(schema, [['String', () => Type.Number()]])

			expect(result.anyOf?.[0]?.['~kind']).toBe('Number')
			expect(result.oneOf?.[0]?.['~kind']).toBe('Number')
			expect(result.allOf?.[0]?.['~kind']).toBe('Number')
		})
	})

	describe('onlyFirst with null return', () => {
		it('should not stop when onlyFirst match returns null', () => {
			const schema = Type.Object({
				a: Type.String(),
				b: Type.String()
			})

			let callCount = 0
			const result = coerce(
				schema,
				[
					[
						'String',
						() => {
							callCount++
							if (callCount === 1) return null
							return Type.Number()
						}
					]
				],
				{ onlyFirst: 'String' }
			)

			expect(callCount).toBe(2)
			const kinds = Object.values(result.properties!).map(
				(p) => p['~kind']
			)
			expect(kinds.filter((k) => k === 'Number').length).toBe(1)
			expect(kinds.filter((k) => k === 'String').length).toBe(1)
		})
	})

	describe('option combinations', () => {
		it('root: true + onlyFirst should only match root', () => {
			const schema = Type.String()
			const result = coerce(schema, [['String', () => Type.Number()]], {
				root: true,
				onlyFirst: 'String'
			})
			expect(result['~kind']).toBe('Number')
		})

		it('root: true + onlyFirst with non-matching root', () => {
			const schema = Type.Object({
				name: Type.String()
			})

			let callCount = 0
			const result = coerce(
				schema,
				[
					[
						'String',
						() => {
							callCount++
							return Type.Number()
						}
					]
				],
				{ root: true, onlyFirst: 'String' }
			)

			expect(callCount).toBe(0)
			expect(result.properties?.name?.['~kind']).toBe('String')
		})

		it('root: false + untilNonRootObjectFound', () => {
			const schema = Type.Object({
				nested: Type.Object({ value: Type.String() })
			})

			const result = coerce(
				schema,
				[['Object', () => Type.Array(Type.Any())]],
				{ root: false, untilNonRootObjectFound: true }
			)

			expect(result.properties?.nested?.['~kind']).toBe('Object')
		})
	})

	describe('stopping during combinator traversal', () => {
		it('should stop mid-combinator when onlyFirst triggers', () => {
			const schema = {
				'~kind': 'Union',
				anyOf: [Type.String(), Type.String(), Type.String()]
			} as BaseSchema

			let callCount = 0
			coerce(
				schema,
				[
					[
						'String',
						() => {
							callCount++
							return Type.Number()
						}
					]
				],
				{ onlyFirst: 'String' }
			)

			expect(callCount).toBe(1)
		})

		it('returns the original combinator when traversal stops before allocating a copy', () => {
			const innerStrings = [Type.String(), Type.String(), Type.String()]
			const schema = {
				'~kind': 'Union',
				anyOf: innerStrings
			} as BaseSchema

			const result = coerce(
				schema,
				[
					[
						'String',
						() => {
							return Type.Number()
						}
					]
				],
				{ onlyFirst: 'String' }
			)

			expect(result).toBe(schema)
			expect(result.anyOf).toBe(innerStrings)
		})
	})

	describe('$ref to non-existent key', () => {
		it('should handle $ref pointing to non-existent $defs key', () => {
			const schema = {
				'~kind': 'Cyclic',
				$ref: 'NonExistent',
				$defs: { Exists: Type.String() }
			} as BaseSchema

			const result = coerce(schema, [['String', () => Type.Number()]])
			expect(result['~kind']).toBe('Cyclic')
			expect(result.$defs?.Exists?.['~kind']).toBe('String')
		})

		it('should not traverse $defs when $ref is missing', () => {
			const schema = {
				'~kind': 'Cyclic',
				$defs: { SomeDef: Type.String() }
			} as BaseSchema

			const result = coerce(schema, [['String', () => Type.Number()]])
			expect(result.$defs?.SomeDef?.['~kind']).toBe('String')
		})
	})

	describe('structural sharing in tuple', () => {
		it('should preserve reference for unchanged tuple items', () => {
			const unchanged = Type.Number()
			const schema = Type.Tuple([
				Type.String(),
				unchanged,
				Type.Boolean()
			])

			const result = coerce(schema, [['String', () => Type.Integer()]])
			const items = result.items as BaseSchema[]

			expect(items[1]).toBe(unchanged)
			expect(items[0]?.['~kind']).toBe('Integer')
			expect(items[2]?.['~kind']).toBe('Boolean')
		})
	})

	describe('transformation returning same reference', () => {
		it('should treat identity transform as a replacement due to type deletion', () => {
			const inner = Type.String()
			const schema = Type.Object({ name: inner })

			const result = coerce(schema, [['String', (s) => s as BaseSchema]])

			expect(result.properties?.name).not.toBe(inner)
			expect(result.properties?.name?.type).toBeUndefined()
		})
	})

	describe('null/primitive in properties', () => {
		it('should handle null values in properties gracefully', () => {
			const schema = {
				'~kind': 'Object',
				properties: { valid: Type.String(), invalid: null }
			} as any

			const result = coerce(schema, [['String', () => Type.Number()]])
			expect(result.properties?.valid?.['~kind']).toBe('Number')
			expect(result.properties?.invalid).toBeNull()
		})

		it('should handle undefined values in properties gracefully', () => {
			const schema = {
				'~kind': 'Object',
				properties: { valid: Type.String(), missing: undefined }
			} as any

			const result = coerce(schema, [['String', () => Type.Number()]])
			expect(result.properties?.valid?.['~kind']).toBe('Number')
			expect(result.properties?.missing).toBeUndefined()
		})
	})

	describe('untraversed schema fields', () => {
		it('should NOT traverse additionalItems', () => {
			const schema = {
				'~kind': 'Tuple',
				items: [Type.String()],
				additionalItems: Type.String()
			} as BaseSchema

			const result = coerce(schema, [['String', () => Type.Number()]])

			expect((result.items as BaseSchema[])[0]?.['~kind']).toBe('Number')
			expect((result.additionalItems as BaseSchema)?.['~kind']).toBe(
				'String'
			)
		})

		it('should NOT traverse definitions (draft-04 style)', () => {
			const schema = {
				'~kind': 'Object',
				properties: {},
				definitions: { MyType: Type.String() }
			} as BaseSchema

			const result = coerce(schema, [['String', () => Type.Number()]])
			expect(result.definitions?.MyType?.['~kind']).toBe('String')
		})

		it('should NOT traverse dependencies', () => {
			const schema = {
				'~kind': 'Object',
				properties: {},
				dependencies: { field: Type.Object({ dep: Type.String() }) }
			} as BaseSchema

			const result = coerce(schema, [['String', () => Type.Number()]])
			expect(
				(result.dependencies?.field as BaseSchema)?.properties?.dep?.[
					'~kind'
				]
			).toBe('String')
		})
	})

	describe('function signature', () => {
		it('should work with minimal arguments', () => {
			const schema = Type.Object({ name: Type.String() })
			const result = coerce(schema, [['String', () => Type.Number()]])
			expect(result.properties?.name?.['~kind']).toBe('Number')
		})

		it('should work with options argument', () => {
			const schema = Type.Object({ name: Type.String() })
			const result = coerce(schema, [['String', () => Type.Number()]], {})
			expect(result.properties?.name?.['~kind']).toBe('Number')
		})
	})
})
