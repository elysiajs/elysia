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

	// A refine predicate may itself run the SAME validator instance (recursion
	// through the public validate path). The pooled scratch is per-validator, so
	// the nested call must NOT reuse the outer call's occupied slots — otherwise
	// the nested #validate bumps the shared epoch / resets the occurrence
	// counters and the outer Check reads wrong-occurrence verdicts, ACCEPTING an
	// invalid input. This encodes that same-validator reentrancy stays isolated.
	it('does not corrupt outer verdicts on same-validator recursion', () => {
		let validator: TypeBoxValidator<any>
		const refined = t.Refine(t.String(), (value: string) => {
			// On the recursion trigger, validate a strictly-valid sub-input on
			// the SAME instance, then reject the outer element. If the nested
			// call clobbers the outer scratch, the outer array is wrongly
			// accepted despite this `false`.
			if (value === 'trigger') {
				validator.Check(['ok'] as any)
				return false
			}
			return true
		})
		validator = new TypeBoxValidator(t.Array(refined))

		try {
			validator.FromSync(['ok', 'trigger'] as any)
			expect.unreachable('recursion clobbered the outer verdict slot')
		} catch (error: any) {
			// The second element ("trigger") must be reported as invalid.
			expect(error.errors.length).toBeGreaterThanOrEqual(1)
		}
	})

	// Pooled verdict rows persist across validations. When one request records
	// verdicts for occurrences [0,1] and the next request short-circuits at
	// occurrence 0 (element 0 fails structurally/refine-wise, Check stops), the
	// Errors() replay must NOT read occurrence 1's STALE row from the previous
	// request. An occurrence never recorded in THIS validation must replay as a
	// pass (unvisited sibling), never inherit a prior failure.
	it('does not inherit stale verdicts for unvisited occurrences', () => {
		const refined = t.Refine(t.String(), (value: string) => value !== 'bad')
		const validator = new TypeBoxValidator(t.Array(refined))

		// First request: occ0 = 'ok' (true), occ1 = 'bad' (false) — records both.
		try {
			validator.FromSync(['ok', 'bad'] as any)
			expect.unreachable()
		} catch (error: any) {
			expect(error.errors).toHaveLength(1)
		}

		// Second request: occ0 = 'bad' (false) short-circuits. occ1 = 'ok' is
		// never recorded this validation; its stale row from request 1 must not
		// resurface as a phantom error on the passing element.
		try {
			validator.FromSync(['bad', 'ok'] as any)
			expect.unreachable()
		} catch (error: any) {
			expect(error.errors).toHaveLength(1)
		}
	})
})
