import { describe, expect, it } from 'bun:test'
import { Type } from '@sinclair/typebox'
import { hasAdditionalProperties } from '../../src/schema'

describe('hasAdditionalProperties', () => {
	it('should handle object schemas without properties key', () => {
		const schema = Type.Intersect([
			Type.Object({ a: Type.String() }),
			// Record schemas does not have properties key, instead it has patternProperties
			Type.Record(Type.Number(), Type.String())
		])
		expect(hasAdditionalProperties(schema)).toBe(false)
	})
})
