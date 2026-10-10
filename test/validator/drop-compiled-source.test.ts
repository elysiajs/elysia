import { describe, it, expect } from 'bun:test'
import { Type } from 'typebox'
import { TypeBoxValidator } from '../../src/type/validator'

describe('validator drops compiled source', () => {
	it('defers the typebox Compile until the hit threshold (lazy-JIT)', () => {
		// A plain (non-eager, non-capturing) validator starts interpreted: no
		// `new Function` JIT is retained, so `tb` is undefined until it materializes.
		const v = new TypeBoxValidator(Type.Object({ a: Type.String() }))
		expect(v.tb).toBeUndefined()
	})

	it('releases the codegen source once compiled (eager path)', () => {
		// `eager` (precompile / .compile()) forces the compile at construction.
		const v = new TypeBoxValidator(Type.Object({ a: Type.String() }), {
			eager: true
		})
		const tb = v.tb as any
		expect(tb).toBeDefined()
		expect(tb.evaluateResult?.code).toBeUndefined()
		expect(tb.buildResult?.functions).toBeUndefined()
	})

	it('releases the codegen source once materialized (deferred path)', () => {
		const v = new TypeBoxValidator(Type.Object({ a: Type.String() }))
		expect(v.tb).toBeUndefined()

		// Cross the hit threshold (16) so the deferred validator materializes.
		for (let i = 0; i < 16; i++) v.Check({ a: 'x' } as any)

		const tb = v.tb as any
		expect(tb).toBeDefined()
		expect(tb.evaluateResult?.code).toBeUndefined()
		expect(tb.buildResult?.functions).toBeUndefined()
	})

	it('Check still works while deferred and after materialization', () => {
		const v = new TypeBoxValidator(Type.Object({ a: Type.String() }))

		// Interpreted (deferred) verdicts.
		expect(v.Check({ a: 'x' } as any)).toBe(true)
		expect(v.Check({ a: 1 } as any)).toBe(false)

		// Drive past the threshold, then re-check on the compiled path.
		for (let i = 0; i < 16; i++) v.Check({ a: 'x' } as any)
		expect(v.tb).toBeDefined()
		expect(v.Check({ a: 'y' } as any)).toBe(true)
		expect(v.Check({ a: 2 } as any)).toBe(false)
	})
})
