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

		expect(
			validator.Check({
				name: 'Elysia',
				age: 1
			})
		).toEqual({
			value: {
				name: 'Elysia',
				age: 1
			}
		})
	})
})
