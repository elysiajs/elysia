import { describe, expect, it } from 'bun:test'
import { Type } from 'typebox'
import { Default } from 'typebox/value'

import { TypeBoxValidator } from '../../src/type/validator'

describe('default merging allocation', () => {
	it('returns complete flat input by reference', () => {
		const schema = Type.Object({
			page: Type.Number({ default: 1 }),
			name: Type.String()
		})
		const v = new TypeBoxValidator(schema, { normalize: false })
		const input = { page: 5, name: 'x' }
		const out = v.FromSync(input as any)

		expect(out).toBe(input as any)
		expect(out).toEqual(Default(schema, { page: 5, name: 'x' }) as any)
	})

	it('allocates a flat object when filling a missing default', () => {
		const schema = Type.Object({
			page: Type.Number({ default: 1 }),
			name: Type.String()
		})
		const v = new TypeBoxValidator(schema, { normalize: false })
		const input = { name: 'x' }
		const out = v.FromSync(input as any)

		expect(out).not.toBe(input as any)
		expect(out).toEqual({ page: 1, name: 'x' } as any)
		expect(out).toEqual(Default(schema, { name: 'x' }) as any)
	})

	it('returns complete nested input by reference', () => {
		const schema = Type.Object({
			a: Type.Object({ x: Type.Number({ default: 7 }) })
		})
		const v = new TypeBoxValidator(schema, { normalize: false })
		const input = { a: { x: 3 } }
		const out = v.FromSync(input as any)

		expect(out).toBe(input as any)
		expect(out).toEqual({ a: { x: 3 } } as any)
	})

	it('allocates nested input when filling a missing default', () => {
		const schema = Type.Object({
			a: Type.Object({ x: Type.Number({ default: 7 }) })
		})
		const v = new TypeBoxValidator(schema, { normalize: false })
		const input = { a: {} }
		const out = v.FromSync(input as any)

		expect(out).not.toBe(input as any)
		expect(out).toEqual({ a: { x: 7 } } as any)
		expect(out).toEqual(Default(schema, { a: {} }) as any)
	})

	it('only allocates deep input when a default is missing', () => {
		const schema = Type.Object({
			a: Type.Object({
				b: Type.Object({ c: Type.Number({ default: 1 }) })
			})
		})
		const v = new TypeBoxValidator(schema, { normalize: false })

		const complete = { a: { b: { c: 9 } } }
		expect(v.FromSync(complete as any)).toBe(complete as any)

		const partial = { a: { b: {} } }
		const out = v.FromSync(partial as any)
		expect(out).not.toBe(partial as any)
		expect(out).toEqual(Default(schema, { a: { b: {} } }) as any)
	})

	it('closed object with a default returns input unchanged through the request path', () => {
		const schema = Type.Object(
			{ page: Type.Number({ default: 1 }), name: Type.String() },
			{ additionalProperties: false }
		)
		const v = new TypeBoxValidator(schema)
		const input = { page: 5, name: 'x' }
		expect(v.FromSync(input as any)).toBe(input as any)
	})
})
