import '../../src/compile/aot-capture'
import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { TypeBoxValidator } from '../../src/type/validator'
import { Compiled, type ValidatorManifest } from '../../src/compile/aot'
import {
	beginValidatorCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { claimManifest, materialise, registerManifest } from './_manifest'
import { req } from '../utils'

/** Frozen codec responses encode and clean without interpreted TypeBox calls. */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const captureResponse = (schema: any, path: string): ValidatorManifest => {
	beginValidatorCapture()
	new TypeBoxValidator(schema, {
		aot: { method: 'GET', path },
		slot: 'response:200' as any
	})
	return materialise(endValidatorCapture())
}

const make = () =>
	t.Object({
		page: t.Numeric(),
		active: t.BooleanString(),
		when: t.Date()
	})

const inputs = [
	{ page: 5, active: true, when: new Date('2020-01-02T00:00:00Z') },
	{ page: 0, active: false, when: new Date('2021-06-15T00:00:00Z') }
]

describe('frozen response encoding', () => {
	it('matches runtime encoding without compiling at runtime', () => {
		const m = captureResponse(make(), '/em')
		expect(m.GET?.['/em']?.['response:200']?.em).toBeDefined()

		Compiled.clear()
		Validator.clear()
		const jit = new TypeBoxValidator(make()) as any

		Validator.clear()
		const frozen = Validator.create(make() as any, {
			aot: { method: 'GET', path: '/em' },
			slot: 'response:200' as any,
			frozen: m.GET!['/em']!['response:200']
		}) as any

		expect(frozen.tb).toBeUndefined()

		for (const input of inputs)
			expect(
				frozen.EncodeFrom(structuredClone(input), 'response')
			).toEqual(jit.EncodeFrom(structuredClone(input), 'response'))

		const out = frozen.EncodeFrom(
			{ page: 7, active: false, when: new Date('2020-01-02T00:00:00Z') },
			'response'
		)
		expect(out.page).toBe(7)
		expect(out.active).toBe(false)
		expect(out.when).toBe('2020-01-02T00:00:00.000Z')
	})

	it('uses the frozen encoder instead of TypeBox Encode', () => {
		const m = captureResponse(make(), '/emlive')
		expect(m.GET?.['/emlive']?.['response:200']?.em).toBeDefined()

		let emCalls = 0
		m.GET!['/emlive']!['response:200']!.em!.s = (() => (v: unknown) => {
			emCalls++
			return v
		}) as any

		Validator.clear()
		const frozen = Validator.create(make() as any, {
			aot: { method: 'GET', path: '/emlive' },
			slot: 'response:200' as any,
			frozen: m.GET!['/emlive']!['response:200']
		}) as any

		frozen.EncodeFrom(
			{ page: 1, active: true, when: new Date('2020-01-02T00:00:00Z') },
			'response'
		)
		expect(emCalls).toBe(1)
	})

	it('matches runtime encoding and strips unknown properties', () => {
		const runtime = new TypeBoxValidator(make(), {
			slot: 'response:200' as any
		}) as any

		const m = captureResponse(make(), '/eq')
		Validator.clear()
		const frozen = Validator.create(make() as any, {
			aot: { method: 'GET', path: '/eq' },
			slot: 'response:200' as any,
			frozen: m.GET!['/eq']!['response:200']
		}) as any

		const dirty = {
			page: 3,
			active: true,
			when: new Date('2020-01-02T00:00:00Z'),
			extra: 'strip'
		}
		const r = runtime.EncodeFrom(structuredClone(dirty), 'response')
		const f = frozen.EncodeFrom(structuredClone(dirty), 'response')
		expect(f).toEqual(r)
		expect((r as any).extra).toBeUndefined()
	})

	it('encodes a codec response on a real route', async () => {
		const build = () =>
			new Elysia().get(
				'/u',
				{
					response: {
						200: t.Object({ id: t.Numeric(), at: t.Date() })
					}
				},
				() => ({ id: 1, at: new Date('2020-01-01T00:00:00Z') })
			)

		beginValidatorCapture()
		build().compile()
		const m = materialise(endValidatorCapture())
		expect(m.GET?.['/u']?.['response:200']?.em).toBeDefined()

		Validator.clear()
		registerManifest({ validators: m }, build())
		const app = build()
		app.compile()

		const res = await app.handle(req('/u'))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({
			id: 1,
			at: '2020-01-01T00:00:00.000Z'
		})
	})
})
