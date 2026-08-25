import { describe, expect, it } from 'bun:test'
import { Type } from 'typebox'

import { t } from '../../src'
import { setupTypebox } from '../../src/type/compat'
import { TypeBoxValidator } from '../../src/type/validator'

// Direct validator construction requires initialized custom types.
setupTypebox()

describe('closed object normalization', () => {
	const closed = Type.Object(
		{ a: Type.Number(), b: Type.String() },
		{ additionalProperties: false }
	)

	it('returns a valid closed object by reference', () => {
		const v = new TypeBoxValidator(closed)
		const input = { a: 1, b: 'x' }
		const out = v.FromSync(input as any)

		expect(out).toBe(input as any)
		expect(out).toEqual({ a: 1, b: 'x' } as any)
	})

	it('rejects an excess property instead of stripping it', () => {
		const v = new TypeBoxValidator(closed)
		expect(() => v.FromSync({ a: 1, b: 'x', c: 9 } as any)).toThrow()
	})

	it('returns a nested closed object by reference', () => {
		const schema = Type.Object(
			{
				a: Type.Object(
					{ x: Type.Number() },
					{ additionalProperties: false }
				)
			},
			{ additionalProperties: false }
		)
		const v = new TypeBoxValidator(schema)
		const input = { a: { x: 1 } }
		expect(v.FromSync(input as any)).toBe(input as any)
	})

	it('strips excess properties from an open object', () => {
		const open = Type.Object({ a: Type.Number(), b: Type.String() })
		const v = new TypeBoxValidator(open)
		const input = { a: 1, b: 'x', extra: 'drop-me' }
		const out = v.FromSync(input as any)

		expect(out).not.toBe(input as any)
		expect(out).toEqual({ a: 1, b: 'x' } as any)
	})

	it('decodes a codec member in a closed object', () => {
		const schema = Type.Object(
			{ n: t.Numeric() },
			{ additionalProperties: false }
		)
		const v = new TypeBoxValidator(schema)
		const out: any = v.FromSync({ n: '5' } as any)
		expect(out.n).toBe(5)
	})

	it('uses TypeBox Clean when normalize is typebox', () => {
		const v = new TypeBoxValidator(closed, { normalize: 'typebox' })
		const out = v.FromSync({ a: 1, b: 'x' } as any)
		expect(out).toEqual({ a: 1, b: 'x' } as any)
	})
})
