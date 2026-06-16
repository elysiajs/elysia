import { describe, it, expect } from 'bun:test'
import { Type } from 'typebox'
import { TypeBoxValidator } from '../../src/type/validator'

// H17: a non-capturing (lazy) validator must release typebox's retained codegen
// source (evaluateResult.code + buildResult.functions) — dead weight once .Check
// is compiled.
describe('validator drops compiled source (H17)', () => {
	it('releases the codegen source on the non-capturing path', () => {
		const v = new TypeBoxValidator(Type.Object({ a: Type.String() }))
		const tb = v.tb as any
		expect(tb).toBeDefined()
		expect(tb.evaluateResult?.code).toBeUndefined()
		expect(tb.buildResult?.functions).toBeUndefined()
	})

	it('Check still works after the source is dropped', () => {
		const v = new TypeBoxValidator(Type.Object({ a: Type.String() }))
		expect(v.Check({ a: 'x' } as any)).toBe(true)
		expect(v.Check({ a: 1 } as any)).toBe(false)
	})
})
