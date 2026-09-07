import { describe, it, expect } from 'bun:test'

import { Elysia, t, getSchemaValidator } from '../../src'
import { z } from 'zod'

describe('getSchemaValidator', () => {
	it('handle TypeBox as sub type', () => {
		const validator = getSchemaValidator(
			z.object({
				name: z.string()
			}),
			{
				validators: [
					t.Object({
						age: t.Number()
					})
				]
			}
		)

		// `Validate` carries the Standard Schema `{ value } | { issues }`
		// wrapper, which is where the merged TypeBox sub type shows up.
		// The cast is needed because `Validate` is typed as the main schema's
		// output — it cannot express keys contributed by `validators`.
		expect(
			validator.Validate!({
				name: 'Elysia',
				age: 1
			})
		).toEqual({
			value: {
				name: 'Elysia',
				age: 1
			}
		} as any)

		// `Check` is the boolean contract shared with the TypeBox provider.
		// It must never return the wrapper: a failure wrapper is truthy, so
		// the `Check(x) === false` test used by dynamic mode and the AOT
		// codegen would skip the 422 branch and let invalid input through.
		expect(validator.Check({ name: 'Elysia', age: 1 })).toBe(true)
		expect(validator.Check({ name: 'Elysia' })).toBe(false)
		expect(validator.Check({ age: 1 })).toBe(false)
	})
})
