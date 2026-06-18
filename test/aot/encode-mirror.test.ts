import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { TypeBoxValidator } from '../../src/type/validator'
import {
	Compiled,
	beginValidatorCapture,
	endValidatorCapture,
	type ValidatorManifest
} from '../../src/compile/aot'
import { materialise } from './_manifest'
import { req } from '../utils'

/**
 * AOT encode freeze — the response-side counterpart to the decode mirror (`dm`).
 * Codec responses freeze a compiled encode+clean (`em`) whose `d.codecs` are the
 * live schema's `~codec.encode` leaves, so `EncodeFrom` skips TypeBox's
 * interpreted `Encode` (and the runtime `createMirror`/`Compile`) entirely.
 */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

// Capture a response validator directly (slot `response:200`), mirroring the
// `captureDirect` helpers in coerce/mirror tests.
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

describe('AOT encode freeze (response-side encode mirror)', () => {
	it('freezes the encode mirror (em) and encodes via it, eval-free', () => {
		const m = captureResponse(make(), '/em')
		// the encode mirror was captured AND frozen (not skipped as unfreezable)
		expect(m.GET?.['/em']?.['response:200']?.em).toBeDefined()

		// JIT reference: no slot → EncodeFrom uses interpreted TypeBox Encode
		Compiled.clear()
		Validator.clear()
		const jit = new TypeBoxValidator(make()) as any

		// Frozen: bind the manifest, reconstruct
		Validator.clear()
		Compiled.validators = m
		const frozen = Validator.create(make() as any, {
			aot: { method: 'GET', path: '/em' },
			slot: 'response:200' as any
		}) as any

		expect(frozen.tb).toBeUndefined() // Compile skipped → genuinely frozen

		// differential: the frozen encode ≡ the interpreted encode
		for (const input of inputs)
			expect(frozen.EncodeFrom(structuredClone(input), 'response')).toEqual(
				jit.EncodeFrom(structuredClone(input), 'response')
			)

		// the codecs really ran: Date → ISO string, primitives preserved
		const out = frozen.EncodeFrom(
			{ page: 7, active: false, when: new Date('2020-01-02T00:00:00Z') },
			'response'
		)
		expect(out.page).toBe(7)
		expect(out.active).toBe(false)
		expect(out.when).toBe('2020-01-02T00:00:00.000Z')
	})

	it('executes the frozen encode mirror, not TypeBox Encode', () => {
		const m = captureResponse(make(), '/emlive')
		expect(m.GET?.['/emlive']?.['response:200']?.em).toBeDefined()

		// swap the frozen encode mirror factory for a counter so we can prove it ran
		let emCalls = 0
		m.GET!['/emlive']!['response:200']!.em!.s = (() => (v: unknown) => {
			emCalls++
			return v
		}) as any

		Validator.clear()
		Compiled.validators = m
		const frozen = Validator.create(make() as any, {
			aot: { method: 'GET', path: '/emlive' },
			slot: 'response:200' as any
		}) as any

		frozen.EncodeFrom(
			{ page: 1, active: true, when: new Date('2020-01-02T00:00:00Z') },
			'response'
		)
		expect(emCalls).toBe(1) // the frozen em encoded; interpreted Encode was NOT used
	})

	it('frozen encode ≡ runtime encode mirror ≡ TypeBox Encode (extra stripped)', () => {
		// runtime encode mirror (response slot, no aot)
		const runtime = new TypeBoxValidator(make(), {
			slot: 'response:200' as any
		}) as any

		const m = captureResponse(make(), '/eq')
		Validator.clear()
		Compiled.validators = m
		const frozen = Validator.create(make() as any, {
			aot: { method: 'GET', path: '/eq' },
			slot: 'response:200' as any
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
		expect((r as any).extra).toBeUndefined() // unknown key stripped by the clean walk
	})

	it('end-to-end: a frozen codec response encodes through em on a real route', async () => {
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
		Compiled.validators = m
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
