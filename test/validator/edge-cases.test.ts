import { describe, expect, it } from 'bun:test'
import { Type } from 'typebox'
import { Default } from 'typebox/value'

import { t } from '../../src'
import { coerceQuery } from '../../src/type/coerce'
import { TypeBoxValidator } from '../../src/type/validator'
import { setupTypebox } from '../../src/type/compat'

// Force the typebox compat module to initialize before constructing validators
// directly (the public `t` proxy normally does this on first access).
setupTypebox()

describe('skip Clean walk on fully-closed objects', () => {
	const closed = Type.Object(
		{ a: Type.Number(), b: Type.String() },
		{ additionalProperties: false }
	)

	it('closed object: valid input passes through unchanged (Clean skipped)', () => {
		const v = new TypeBoxValidator(closed)
		const input = { a: 1, b: 'x' }
		const out = v.FromSync(input as any)

		// Skipping Clean means the input reference is returned verbatim.
		expect(out).toBe(input as any)
		expect(out).toEqual({ a: 1, b: 'x' } as any)
	})

	it('closed object: excess key is rejected by Check (not silently stripped)', () => {
		const v = new TypeBoxValidator(closed)
		// additionalProperties:false → Check fails, so we never reach Clean.
		expect(() => v.FromSync({ a: 1, b: 'x', c: 9 } as any)).toThrow()
	})

	it('nested closed object also short-circuits Clean', () => {
		const schema = Type.Object(
			{
				a: Type.Object({ x: Type.Number() }, { additionalProperties: false })
			},
			{ additionalProperties: false }
		)
		const v = new TypeBoxValidator(schema)
		const input = { a: { x: 1 } }
		expect(v.FromSync(input as any)).toBe(input as any)
	})

	it('OPEN object still runs Clean and strips excess keys (unchanged behavior)', () => {
		// Default t.Object is open (additionalProperties: undefined), so Check
		// does NOT reject excess keys — Clean must still run to strip them.
		const open = Type.Object({ a: Type.Number(), b: Type.String() })
		const v = new TypeBoxValidator(open)
		const input = { a: 1, b: 'x', extra: 'drop-me' }
		const out = v.FromSync(input as any)

		expect(out).not.toBe(input as any) // fresh object from Clean
		expect(out).toEqual({ a: 1, b: 'x' } as any) // excess stripped
	})

	it('closed object with a codec member does NOT skip Clean (decode owns output)', () => {
		// hasCodec routes through the decode mirror, not the Clean fast-path;
		// the closed-object skip must not interfere. Value must still decode.
		const schema = Type.Object(
			{ n: t.Numeric() },
			{ additionalProperties: false }
		)
		const v = new TypeBoxValidator(schema)
		const out: any = v.FromSync({ n: '5' } as any)
		expect(out.n).toBe(5) // decoded to a number
	})

	it('normalize:"typebox" keeps TypeBox Clean semantics (no fast-path skip)', () => {
		// normalize:'typebox' uses TypeBox `Clean` instead of skipping cleanup.
		// (TypeBox Clean is same-ref/in-place for already-clean input, so we
		// assert on value, not reference — the point is that the closed-object
		// skip must NOT hijack the explicit typebox request.)
		const v = new TypeBoxValidator(closed, { normalize: 'typebox' })
		const out = v.FromSync({ a: 1, b: 'x' } as any)
		expect(out).toEqual({ a: 1, b: 'x' } as any)
	})
})

describe('default merger returns input unchanged when complete', () => {
	it('flat: all defaults present → same reference returned', () => {
		const schema = Type.Object({
			page: Type.Number({ default: 1 }),
			name: Type.String()
		})
		const v = new TypeBoxValidator(schema, { normalize: false })
		const input = { page: 5, name: 'x' }
		const out = v.FromSync(input as any)

		expect(out).toBe(input as any) // no reallocation
		expect(out).toEqual(Default(schema, { page: 5, name: 'x' }) as any)
	})

	it('flat: a missing default → new object, correctly filled', () => {
		const schema = Type.Object({
			page: Type.Number({ default: 1 }),
			name: Type.String()
		})
		const v = new TypeBoxValidator(schema, { normalize: false })
		const input = { name: 'x' }
		const out = v.FromSync(input as any)

		expect(out).not.toBe(input as any) // reallocated to fill `page`
		expect(out).toEqual({ page: 1, name: 'x' } as any)
		expect(out).toEqual(Default(schema, { name: 'x' }) as any)
	})

	it('nested: complete nested input → same reference all the way down', () => {
		const schema = Type.Object({
			a: Type.Object({ x: Type.Number({ default: 7 }) })
		})
		const v = new TypeBoxValidator(schema, { normalize: false })
		const input = { a: { x: 3 } }
		const out = v.FromSync(input as any)

		expect(out).toBe(input as any)
		expect(out).toEqual({ a: { x: 3 } } as any)
	})

	it('nested: missing nested default → filled, matches Default()', () => {
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

	it('deep: 3-level complete input → unchanged; incomplete → filled', () => {
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

describe('refine validation', () => {
	it('uses only Check on a valid coerced-query path', () => {
		let checks = 0
		let errorWalks = 0
		const validator = new TypeBoxValidator(t.Object({ page: t.Number() }), {
			coerces: coerceQuery()
		})
		const check = validator.Check.bind(validator)
		validator.Check = (value) => {
			checks++
			return check(value)
		}
		const errors = validator.Errors.bind(validator)
		validator.Errors = (value) => {
			errorWalks++
			return errors(value)
		}

		expect(validator.FromSync({ page: '1' } as any)).toEqual({ page: 1 })
		expect(checks).toBe(1)
		expect(errorWalks).toBe(0)
	})

	it('runs a valid user refine once', () => {
		let calls = 0
		const validator = new TypeBoxValidator(
			t.Refine(t.String(), () => {
				calls++
				return true
			})
		)

		expect(validator.FromSync('ok')).toBe('ok')
		expect(calls).toBe(1)
	})

	it('does not run or fail an unvisited sibling refine during error enumeration', () => {
		let calls = 0
		const refined = t.Refine(t.String(), () => {
			calls++
			return false
		})
		const validator = new TypeBoxValidator(
			t.Object({
				first: refined,
				sibling: refined
			})
		)

		try {
			validator.FromSync({ first: 'bad', sibling: 'bad' })
			expect.unreachable()
		} catch (error: any) {
			expect(error.errors).toHaveLength(1)
		}
		expect(calls).toBe(1)
	})

	it('reports every failing refine at one visited schema node once', () => {
		let first = 0
		let second = 0
		const validator = new TypeBoxValidator(
			t.Refine(
				t.Refine(t.String(), () => {
					first++
					return false
				}),
				() => {
					second++
					return false
				}
			)
		)

		try {
			validator.FromSync('bad')
			expect.unreachable()
		} catch (error: any) {
			expect(error.errors).toHaveLength(2)
		}
		expect(first).toBe(1)
		expect(second).toBe(1)
	})
})
