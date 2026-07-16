import '../../src/compile/aot-capture'
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

/** Response validators are frozen independently for each declared status. */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const buildResponseApp = () =>
	new Elysia().get(
		'/u',
		{
			response: {
				200: t.Object({ id: t.String(), name: t.String() }),
				404: t.Object({ error: t.String() })
			}
		},
		() => ({ id: 'x', name: 'y' })
	)

describe('AOT response freezing', () => {
	it('captures a separate frozen validator for each declared status', () => {
		beginValidatorCapture()
		buildResponseApp().compile()
		const m = materialise(endValidatorCapture())

		expect(m.GET?.['/u']?.['response:200']).toBeDefined()
		expect(m.GET?.['/u']?.['response:404']).toBeDefined()
		expect(
			(m.GET?.['/u'] as Record<string, unknown> | undefined)?.['response']
		).toBeUndefined()

		Validator.clear()
		Compiled.validators = m

		const v = Validator.create(
			t.Object({ id: t.String(), name: t.String() }),
			{ aot: { method: 'GET', path: '/u' }, slot: 'response:200' }
		) as any
		expect(v.tb).toBeUndefined()
		expect(v.reconstructedCheck).toBeDefined()
		expect(v.Check({ id: 'a', name: 'b' })).toBe(true)
		expect(v.Check({ id: 1 })).toBe(false)
	})

	it('strips undeclared properties identically in frozen and live validators', () => {
		const schema = () => t.Object({ id: t.String(), n: t.Number() })

		beginValidatorCapture()
		new Elysia()
			.get(
				'/u',
				{
					response: { 200: schema() }
				},
				() => ({ id: 'a', n: 1 })
			)
			.compile()
		const m = materialise(endValidatorCapture())

		Validator.clear()
		Compiled.clear()
		const live = new TypeBoxValidator(schema()) as any

		Validator.clear()
		Compiled.validators = m
		const frozen = Validator.create(schema(), {
			aot: { method: 'GET', path: '/u' },
			slot: 'response:200'
		}) as any

		expect(frozen.tb).toBeUndefined()
		const input = { id: 'a', n: 1, extra: 'strip' }
		expect(frozen.Clean?.(structuredClone(input))).toEqual(
			live.Clean?.(structuredClone(input))
		)
	})
})
