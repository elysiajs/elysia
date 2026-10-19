import '../../src/compile/aot-capture'
import { it, expect, afterEach } from 'bun:test'
import { t, validationDetail } from '../../src'
import { Validator } from '../../src/validator'
import { TypeBoxValidator } from '../../src/type/validator'
import { Compiled } from '../../src/compile/aot'
import {
	beginValidatorCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { materialise } from './_manifest'

/** Custom error fields retain their own frozen checks and instance paths. */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const P = '/p'
const S = 'body' as const
const capture = (schema: any) => {
	beginValidatorCapture()
	new TypeBoxValidator(schema, {
		aot: { method: 'POST', path: P },
		slot: S
	})
	return materialise(endValidatorCapture())
}
const entry = (m: any) => m.POST?.[P]?.[S]

it('reconstructs and runs a check for each custom-error field', () => {
	const m = capture(
		t.Object({ age: t.Number({ error: 'age must be a number' }) })
	)
	const ce = entry(m)?.ce as any[]
	expect(ce).toBeDefined()
	expect(ce.length).toBe(1)
	expect(ce[0].p).toBe('/age')

	const check = ce[0].c(ce[0].e ? [] : [])
	expect(check(5)).toBe(true)
	expect(check('not a number')).toBe(false)
})

it('records nested custom-error fields by instance path', () => {
	const m = capture(
		t.Object({
			a: t.String({ error: 'a' }),
			nested: t.Object({
				b: t.Number({ error: validationDetail('b') })
			})
		})
	)
	const ce = entry(m)?.ce as any[]
	expect(ce.map((e) => e.p).sort()).toEqual(['/a', '/nested/b'])
})

it('omits custom-error checks when the schema has none', () => {
	const m = capture(t.Object({ x: t.Number() }))
	expect(entry(m)?.ce).toBeUndefined()
})
