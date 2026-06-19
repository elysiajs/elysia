import { it, expect, afterEach } from 'bun:test'
import { t, validationDetail } from '../../src'
import { Validator } from '../../src/validator'
import { TypeBoxValidator } from '../../src/type/validator'
import {
	Compiled,
	beginValidatorCapture,
	endValidatorCapture
} from '../../src/compile/aot'
import { materialise } from './_manifest'

/**
 * AOT custom-error capture — freeze a per-field check for each `error`-annotated
 * field so the production error path can locate the failing field without
 * TypeBox `Errors`. (The production gate itself is exercised in
 * test/validator/validation-detail.test.ts via a spawned NODE_ENV=production
 * fixture; here we verify the baked `ce` channel reconstructs + validates.)
 */

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

it('bakes a per-field check (ce) that reconstructs + validates', () => {
	const m = capture(
		t.Object({ age: t.Number({ error: 'age must be a number' }) })
	)
	const ce = entry(m)?.ce as any[]
	expect(ce).toBeDefined()
	expect(ce.length).toBe(1)
	expect(ce[0].p).toBe('/age')

	// reconstruct the frozen field check: c(externals) -> (value) -> boolean
	const check = ce[0].c(ce[0].e ? [] : [])
	expect(check(5)).toBe(true)
	expect(check('not a number')).toBe(false)
})

it('captures nested + multiple custom-error fields by instancePath', () => {
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

it('no custom errors → no ce channel', () => {
	const m = capture(t.Object({ x: t.Number() }))
	expect(entry(m)?.ce).toBeUndefined()
})
