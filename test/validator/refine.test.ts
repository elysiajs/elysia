import { describe, expect, it } from 'bun:test'

import { t } from '../../src'
import { coerceQuery } from '../../src/type/coerce'
import { TypeBoxValidator } from '../../src/type/validator'

describe('refinement evaluation', () => {
	it('does not enumerate errors after a valid coerced query', () => {
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

	it('runs a successful refinement once', () => {
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

	it('does not evaluate an unvisited sibling refinement', () => {
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

	it('reports each failing refinement at a visited node once', () => {
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
