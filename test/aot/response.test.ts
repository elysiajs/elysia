import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { TypeBoxValidator } from '../../src/type/validator'
import {
	Compiled,
	beginValidatorCapture,
	endValidatorCapture
} from '../../src/compile/aot'
import { materialise } from './_manifest'

/**
 * AOT response freezing — response validators are keyed PER STATUS
 * (`response:<status>`) and frozen like every request slot. Before this, the
 * `response` slot was never set (route.ts can't add it — it doesn't know the
 * statuses), so response validators fell through to `Compile` + `createMirror`
 * on every boot. That's invisible in request-only synthetic apps but dominates
 * boot in real, response-heavy APIs (≈3.9× boot on a response-heavy app).
 */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const RESP = () =>
	new Elysia().get('/u', () => ({ id: 'x', name: 'y' }), {
		response: {
			200: t.Object({ id: t.String(), name: t.String() }),
			404: t.Object({ error: t.String() })
		}
	})

describe('AOT response freezing', () => {
	it('captures + freezes a validator for EACH declared status', () => {
		beginValidatorCapture()
		RESP().compile()
		const m = materialise(endValidatorCapture())

		// one frozen entry per status — not a single bare `response`
		expect(m.GET?.['/u']?.['response:200']).toBeDefined()
		expect(m.GET?.['/u']?.['response:404']).toBeDefined()
		expect(m.GET?.['/u']?.['response']).toBeUndefined()

		Validator.clear()
		Compiled.validators = m

		// a response:200 validator binds the frozen check (Compile skipped) + validates
		const v = Validator.create(
			t.Object({ id: t.String(), name: t.String() }),
			{ aot: { method: 'GET', path: '/u' }, slot: 'response:200' }
		) as any
		expect(v.tb).toBeUndefined() // frozen-bound, not compiled
		expect(v.reconstructedCheck).toBeDefined() // bound eagerly at construction
		expect(v.Check({ id: 'a', name: 'b' })).toBe(true)
		expect(v.Check({ id: 1 })).toBe(false)
	})

	it('differential: frozen response Clean ≡ JIT Clean (extra stripped)', () => {
		const schema = () => t.Object({ id: t.String(), n: t.Number() })

		beginValidatorCapture()
		new Elysia()
			.get('/u', () => ({ id: 'a', n: 1 }), {
				response: { 200: schema() }
			})
			.compile()
		const m = materialise(endValidatorCapture())

		// JIT reference (no manifest)
		Validator.clear()
		Compiled.clear()
		const jit = new TypeBoxValidator(schema()) as any

		// frozen
		Validator.clear()
		Compiled.validators = m
		const frozen = Validator.create(schema(), {
			aot: { method: 'GET', path: '/u' },
			slot: 'response:200'
		}) as any

		expect(frozen.tb).toBeUndefined()
		const input = { id: 'a', n: 1, extra: 'strip' }
		expect(frozen.Clean?.(structuredClone(input))).toEqual(
			jit.Clean?.(structuredClone(input))
		)
	})
})
