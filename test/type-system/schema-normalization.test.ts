import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'

import { t } from '../../src'
import {
	applyCoercions,
	coerceBody,
	coerceQuery,
	nonAdditionalProperties
} from '../../src/type/coerce'

describe('nonAdditionalProperties $defs traversal', () => {
	it('closes objects inside $defs', () => {
		const schema = {
			'~kind': 'Object',
			type: 'object' as const,
			properties: {},
			$defs: {
				Nested: {
					'~kind': 'Object',
					type: 'object' as const,
					properties: {
						a: { type: 'string' as const }
					}
				}
			}
		}

		const result = nonAdditionalProperties(schema as any) as any
		expect(result.$defs?.Nested?.additionalProperties).toBe(false)
	})

	it('preserves an already closed $defs entry', () => {
		const schema = {
			'~kind': 'Object',
			type: 'object' as const,
			properties: {},
			$defs: {
				Nested: {
					'~kind': 'Object',
					type: 'object' as const,
					properties: {},
					additionalProperties: false as const
				}
			}
		}

		const result = nonAdditionalProperties(schema as any) as any
		expect(result.$defs?.Nested?.additionalProperties).toBe(false)
	})
})

describe('coercion preserves schema markers on cloned containers', () => {
	it('keeps ~optional and ~refine on a refined+optional container child', () => {
		const schema = t.Object({
			w: t.Optional(t.Refine(t.Object({ id: t.Integer() }), () => true))
		})

		const before = (schema as any).properties.w
		expect('~optional' in before).toBe(true)
		expect('~refine' in before).toBe(true)

		const coerced: any = applyCoercions(schema as any, coerceBody())
		const after = coerced.properties.w
		expect('~optional' in after).toBe(true)
		expect('~refine' in after).toBe(true)
		expect(coerced['~kind']).toBe('Object')
	})

	it('keeps ~codec on a codec container that wraps a coercible child', () => {
		const codecObj = t
			.Codec(t.Object({ id: t.Integer() }))
			.Decode((v: any) => v)
			.Encode((v: any) => v)
		const schema = t.Object({ c: codecObj })

		const coerced: any = applyCoercions(schema as any, coerceBody())
		expect('~codec' in coerced.properties.c).toBe(true)
	})

	it('continues to coerce integer query values', () => {
		const q = t.Object({ n: t.Integer() })
		const qc: any = applyCoercions(q as any, coerceQuery())
		expect(Value.Check(qc, { n: '5' })).toBe(true)
		expect(Value.Decode(qc, { n: '5' })).toEqual({ n: 5 })
	})
})
