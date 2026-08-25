import { describe, it, expect } from 'bun:test'

import { t } from '../../src'
import { hasProperty } from '../../src/type/utils'

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
