import { describe, it, expect } from 'bun:test'

import { t } from '../../src'
import { hasProperty, getSchemaProperties } from '../../src/schema'

describe('getSchemaProperties', () => {
	it('returns properties for Object schema', () => {
		const schema = t.Object({
			name: t.String(),
			age: t.Number()
		})

		const props = getSchemaProperties(schema)
		expect(props).toBeDefined()
		expect(Object.keys(props!)).toEqual(['name', 'age'])
	})

	it('returns undefined for non-object schema', () => {
		expect(getSchemaProperties(t.String())).toBeUndefined()
		expect(getSchemaProperties(t.Number())).toBeUndefined()
		expect(getSchemaProperties(t.Array(t.String()))).toBeUndefined()
	})

	it('returns undefined for undefined/null', () => {
		expect(getSchemaProperties(undefined)).toBeUndefined()
		expect(getSchemaProperties(null as any)).toBeUndefined()
	})

	it('returns combined properties for Union schema', () => {
		const schema = t.Union([
			t.Object({ name: t.String() }),
			t.Object({ age: t.Number() })
		])

		const props = getSchemaProperties(schema)
		expect(props).toBeDefined()
		expect(Object.keys(props!).sort()).toEqual(['age', 'name'])
	})

	it('returns combined properties for Intersect schema', () => {
		const schema = t.Intersect([
			t.Object({ name: t.String() }),
			t.Object({ age: t.Number() })
		])

		const props = getSchemaProperties(schema)
		expect(props).toBeDefined()
		expect(Object.keys(props!).sort()).toEqual(['age', 'name'])
	})

	it('returns Object properties when property value is Union', () => {
		const schema = t.Object({
			data: t.Union([t.String(), t.Number()])
		})

		const props = getSchemaProperties(schema)
		expect(props).toBeDefined()
		expect(Object.keys(props!)).toEqual(['data'])
	})

	it('handles nested Union/Intersect', () => {
		const schema = t.Union([
			t.Intersect([
				t.Object({ a: t.String() }),
				t.Object({ b: t.Number() })
			]),
			t.Object({ c: t.Boolean() })
		])

		const props = getSchemaProperties(schema)
		expect(props).toBeDefined()
		expect(Object.keys(props!).sort()).toEqual(['a', 'b', 'c'])
	})

	it('handles nested Intersect/Union', () => {
		const schema = t.Intersect([
			t.Union([t.Object({ a: t.String() }), t.Object({ b: t.Number() })]),
			t.Object({ c: t.Boolean() })
		])

		const props = getSchemaProperties(schema)
		expect(props).toBeDefined()
		expect(Object.keys(props!).sort()).toEqual(['a', 'b', 'c'])
	})

	it('returns undefined for empty Union or Intersect', () => {
		expect(getSchemaProperties({ anyOf: [] } as any)).toBeUndefined()
		expect(getSchemaProperties({ allOf: [] } as any)).toBeUndefined()
	})

	it('handles Union with non-object members', () => {
		const schema = t.Union([t.Object({ name: t.String() }), t.String()])

		const props = getSchemaProperties(schema)
		expect(props).toBeDefined()
		expect(Object.keys(props!)).toEqual(['name'])
	})
})

describe('hasProperty', () => {
	it('finds property in Object schema', () => {
		const schema = t.Object({
			name: t.String({ default: 'test' })
		})

		expect(hasProperty('default', schema)).toBe(true)
		expect(hasProperty('minimum', schema)).toBe(false)
	})

	it('finds property in Union schema', () => {
		const schema = t.Union([
			t.Object({ name: t.String({ default: 'test' }) }),
			t.Object({ name: t.String() })
		])

		expect(hasProperty('default', schema)).toBe(true)
	})

	it('finds property in Intersect schema', () => {
		const schema = t.Intersect([
			t.Object({ name: t.String({ default: 'test' }) }),
			t.Object({ age: t.Number() })
		])

		expect(hasProperty('default', schema)).toBe(true)
	})

	it('returns false when property not in any Union member', () => {
		const schema = t.Union([
			t.Object({ name: t.String() }),
			t.Object({ age: t.Number() })
		])

		expect(hasProperty('default', schema)).toBe(false)
	})

	it('finds property in nested Union within Object', () => {
		const schema = t.Object({
			data: t.Union([t.String({ default: 'hello' }), t.Number()])
		})

		expect(hasProperty('default', schema)).toBe(true)
	})

	it('finds property in oneOf schema', () => {
		const schema = {
			oneOf: [
				t.Object({ name: t.String({ default: 'test' }) }),
				t.Object({ name: t.String() })
			]
		}

		expect(hasProperty('default', schema as any)).toBe(true)
	})

	it('returns false for undefined schema', () => {
		expect(hasProperty('default', undefined as any)).toBe(false)
	})

	it('handles deeply nested structures', () => {
		const schema = t.Union([
			t.Intersect([
				t.Object({
					config: t.Object({
						value: t.String({ default: 'nested' })
					})
				})
			])
		])

		expect(hasProperty('default', schema)).toBe(true)
	})
})
