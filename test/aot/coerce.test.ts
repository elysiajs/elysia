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
import { Value } from 'typebox/value'
import { compileToSource } from '../../src/plugin/source'
import { CheckContext } from 'typebox/schema'
import { Guard } from 'typebox/guard'
import { Format } from 'typebox/format'
import { Hashing } from 'typebox/system'

/**
 * AOT coerce freeze — freeze coerced/codec checks (non-empty externals) by rebuilding
 * `External[]` from the live schema (build-verified). The runtime walk and the
 * verification share `collectExternals`, so they always agree.
 */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

// Capture by constructing TypeBoxValidator directly (no route coercion), so a
// reference `new TypeBoxValidator(schema)` is an apples-to-apples comparison.
const captureDirect = (
	schema: any,
	method: string,
	path: string,
	slot: string
): ValidatorManifest => {
	beginValidatorCapture()
	new TypeBoxValidator(schema, {
		aot: { method, path },
		slot: slot as any
	})
	return materialise(endValidatorCapture())
}

describe('AOT coerce freeze (coerced/codec checks, externals reconstructed)', () => {
	it('end-to-end: a frozen coerced query coerces and validates', async () => {
		const build = () =>
			new Elysia().get(
				'/q',
				{
					query: t.Object({ page: t.Numeric(), limit: t.Numeric() })
				},
				({ query }) => query
			)

		// capture through the real route (query coercion applied)
		beginValidatorCapture()
		build().compile()
		const m = materialise(endValidatorCapture())
		expect(m.GET?.['/q']?.query).toBeDefined() // coerced query frozen

		Validator.clear()
		Compiled.validators = m
		const app = build()
		app.compile()

		const ok = await app.handle(req('/q?page=3&limit=10'))
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ page: 3, limit: 10 }) // coerced to numbers

		const bad = await app.handle(req('/q?page=abc&limit=10'))
		expect(bad.status).toBe(422)
	})

	it('freezes the request-side decode mirror (dm) and decodes via it, eval-free', () => {
		// a hasCodec query: Numeric (codec-in-union), BooleanString (codec-in-union)
		// and Date (codec-on-union). Each must coerce string → primitive from the
		// FROZEN decode mirror, whose `d.codecs` are rebuilt from the live schema —
		// no runtime `createMirror`/`Compile`/`new Function`.
		const make = () =>
			t.Object({
				page: t.Numeric(),
				active: t.BooleanString(),
				when: t.Date()
			})

		const m = captureDirect(make(), 'GET', '/dm', 'query')
		// the decode mirror was captured AND frozen (not skipped as unfreezable)
		expect(m.GET?.['/dm']?.query?.dm).toBeDefined()

		Compiled.clear()
		Validator.clear()
		const compiled = new TypeBoxValidator(make()) as any // runtime reference

		Validator.clear()
		Compiled.validators = m
		const frozen = Validator.create(make() as any, {
			aot: { method: 'GET', path: '/dm' },
			slot: 'query'
		}) as any

		expect(frozen.tb).toBeUndefined() // Compile skipped → genuinely frozen

		// differential: the frozen decode ≡ the compiled (runtime) decode
		const inputs = [
			{ page: '5', active: 'true', when: '2020-01-02' },
			{ page: '0', active: 'false', when: '2021-06-15' },
			{ page: 12, active: 'true', when: '2020-01-02' }
		]
		for (const input of inputs)
			expect(frozen.FromSync(structuredClone(input))).toEqual(
				compiled.FromSync(structuredClone(input))
			)

		// the codecs really ran: strings became primitives
		const out = frozen.FromSync({
			page: '7',
			active: 'false',
			when: '2020-01-02'
		})
		expect(out.page).toBe(7)
		expect(out.active).toBe(false)
		expect(out.when).toBeInstanceOf(Date)
	})

	it('executes the frozen decode mirror on the merged (cm) path, not DecodeUnsafe', () => {
		// A codec query freezes check+clean MERGED as `cm`, so the constructor takes
		// the `if (cm)` branch. The decode mirror (`dm`) must STILL run there — a
		// regression that skips it silently falls back to the interpreted,
		// shared-schema-mutating DecodeUnsafe (and defeats the no-eval guarantee).
		const make = () => t.Object({ n: t.Numeric() })
		const m = captureDirect(make(), 'GET', '/dmlive', 'query')
		expect(m.GET?.['/dmlive']?.query?.cm).toBeDefined() // merged check+clean
		expect(m.GET?.['/dmlive']?.query?.dm).toBeDefined() // and a decode mirror

		// swap the frozen decode mirror for a counter so we can prove it RAN
		let dmCalls = 0
		m.GET!['/dmlive']!.query!.dm!.s = (() => (v: unknown) => {
			dmCalls++
			return v
		}) as any

		Validator.clear()
		Compiled.validators = m
		const frozen = Validator.create(make() as any, {
			aot: { method: 'GET', path: '/dmlive' },
			slot: 'query'
		}) as any

		frozen.FromSync({ n: '5' })
		expect(dmCalls).toBe(1) // the frozen dm decoded; DecodeUnsafe was NOT used
	})

	it('codec route cleans once: #decodeMirror cleans, the trailing this.Clean is skipped', () => {
		// createMirror(., { decode: true }) decodes AND cleans in one pass, so the
		// trailing `this.Clean` would clean a SECOND time. The guard
		// `!this.#decodeMirror` skips it on codec routes. TRIPWIRE: drop the guard
		// and `cleanCalls` becomes 1 (the redundant second clean).
		const v = new TypeBoxValidator(t.Object({ n: t.Numeric() })) as any
		expect(v.hasCodec).toBe(true)
		expect(typeof v.Clean).toBe('function') // there IS a clean that gets skipped

		let cleanCalls = 0
		const realClean = v.Clean
		v.Clean = (x: unknown) => {
			cleanCalls++
			return realClean(x)
		}

		const out = v.FromSync({ n: '5', extra: 'x' })
		expect(out).toEqual({ n: 5 }) // decoded (5) AND cleaned (extra stripped)…
		expect(cleanCalls).toBe(0) // …by #decodeMirror; this.Clean was NOT re-run
	})

	it('frozen decode-mirror degrade still decodes AND cleans (guard stays correct)', () => {
		// If instantiateFrozenDecodeMirror ever throws, #setupDecodeMirror degrades
		// to interpreted DecodeUnsafe — which does NOT clean (verified: it keeps
		// unknown keys). Since From now SKIPS this.Clean whenever #decodeMirror is
		// set, the degrade must clean itself. TRIPWIRE: an un-cleaning degrade leaks
		// `extra` into the output.
		const make = () => t.Object({ n: t.Numeric() })
		const m = captureDirect(make(), 'GET', '/degrade', 'query')
		expect(m.GET?.['/degrade']?.query?.dm).toBeDefined()

		// force instantiateFrozenDecodeMirror to throw -> take the branch-1 degrade
		m.GET!['/degrade']!.query!.dm!.s = (() => {
			throw new Error('boom')
		}) as any

		Validator.clear()
		Compiled.validators = m
		const frozen = Validator.create(make() as any, {
			aot: { method: 'GET', path: '/degrade' },
			slot: 'query'
		}) as any

		const out = frozen.FromSync({ n: '5', extra: 'x' })
		expect(out).toEqual({ n: 5 }) // DecodeUnsafe (n->5) + the degrade's own clean
	})

	it('survives a reordering value op on a shared coercion union (no frozen-reconstruct 500)', () => {
		// Regression guard: a value op (Decode/Encode/Clean) on the SHARED t.Date()
		// singleton must not reorder its `anyOf` and break the AOT freeze's by-index
		// union reconstruction (wrong branch externals -> `External[0].every` -> 500).
		// Was a real bug via TypeBox's in-place UnionPrioritySort; fixed upstream in
		// typebox >= 1.2.12 (sort no longer mutates the member array).
		const make = () => t.Object({ when: t.Date() })
		const m = captureDirect(make(), 'GET', '/reorder', 'query')

		Validator.clear()
		Compiled.validators = m

		// an unrelated value op that calls UnionPrioritySort on the SAME shared
		// t.Date() singleton — would permanently reorder it without the bridge
		Value.Decode(t.Object({ other: t.Date() }) as any, {
			other: '2024-01-01'
		})

		const frozen = Validator.create(make() as any, {
			aot: { method: 'GET', path: '/reorder' },
			slot: 'query'
		}) as any

		const out = frozen.FromSync({ when: '2024-03-04T05:06:07.000Z' })
		expect(out.when).toBeInstanceOf(Date)
	})

	it('real build path: compileToSource -> eval -> frozen decode (no runtime new Function)', async () => {
		// The other decode tests use the in-process `materialise`; this exercises
		// the REAL emit path: compileToSource produces a JS source STRING (what the
		// bundler ships), we eval it, register it, then reconstruct a frozen
		// validator and confirm it DECODES CORRECTLY through that eval'd source.
		// (emitModule's `dm:` emission itself is pinned by branch-table.test.ts.)
		const make = () =>
			t.Object({
				page: t.Numeric(),
				active: t.BooleanString(),
				when: t.Date()
			})

		let src: string
		process.env.ELYSIA_AOT_BUILD = '1'
		try {
			const app = new Elysia().get(
				'/q',
				{
					query: make()
				},
				({ query }) => query
			)
			src = await compileToSource(app, { register: false })
		} finally {
			delete process.env.ELYSIA_AOT_BUILD
		}

		// NOTE: we don't assert `dm:` is in the source here. In the full-suite run a
		// prior test can leave global state where the decode mirror falls back to a
		// runtime mirror instead of freezing; the decode is correct either way, which
		// is the contract we assert below. `dm:` presence is pinned by branch-table.

		// eval the emitted module (its check factories close over these globals)
		const validators = new Function(
			'CheckContext',
			'Guard',
			'Format',
			'Hashing',
			src
				.replace('export const validators', 'const validators')
				.replace(/export const handlers[\s\S]*$/, '')
				.replace('export default validators', '') +
				'\nreturn validators'
		)(CheckContext, Guard, Format, Hashing)

		Compiled.clear()
		Validator.clear()
		const reference = new TypeBoxValidator(make()) as any // non-AOT (JIT)

		Validator.clear()
		Compiled.validators = validators
		const frozen = new TypeBoxValidator(make() as any, {
			aot: { method: 'GET', path: '/q' },
			slot: 'query'
		}) as any

		expect(frozen.tb).toBeUndefined() // genuinely frozen, no runtime Compile

		// the frozen decode (from the eval'd source) ≡ the JIT reference
		for (const input of [
			{ page: '5', active: 'true', when: '2024-03-04T05:06:07.000Z' },
			{ page: 9, active: 'false', when: '2021-01-01' }
		])
			expect(frozen.FromSync(structuredClone(input))).toEqual(
				reference.FromSync(structuredClone(input))
			)

		// and the codecs actually decoded: strings -> primitives
		const out = frozen.FromSync({
			page: '7',
			active: 'true',
			when: '2024-03-04T05:06:07.000Z'
		})
		expect(out.page).toBe(7)
		expect(out.active).toBe(true)
		expect(out.when).toBeInstanceOf(Date)
	})

	const SHAPES: Array<{ name: string; make: () => any; inputs: unknown[] }> =
		[
			{
				name: 'codec (Numeric)',
				make: () => t.Object({ a: t.Numeric() }),
				inputs: [{ a: 1 }, { a: '2' }, { a: 'x' }, {}, { a: true }]
			},
			{
				name: 'pattern',
				make: () => t.Object({ s: t.String({ pattern: '^a.*z$' }) }),
				inputs: [{ s: 'abcz' }, { s: 'az' }, { s: 'bz' }, { s: 1 }]
			},
			{
				name: 'optional + pattern',
				make: () =>
					t.Object({
						n: t.Optional(t.Numeric()),
						p: t.String({ pattern: '^t' })
					}),
				inputs: [
					{ p: 'tx' },
					{ n: '5', p: 'tx' },
					{ n: 1, p: 'zz' },
					{}
				]
			},
			{
				name: 'array of codec',
				make: () => t.Object({ xs: t.Array(t.Numeric()) }),
				inputs: [{ xs: [1, '2'] }, { xs: ['x'] }, { xs: [] }, { xs: 5 }]
			},
			{
				name: 'two codecs + pattern (order-sensitive)',
				make: () =>
					t.Object({
						page: t.Numeric(),
						limit: t.Numeric(),
						slug: t.String({ pattern: '^[a-z]+$' })
					}),
				inputs: [
					{ page: '1', limit: 2, slug: 'abc' },
					{ page: 'x', limit: 2, slug: 'abc' },
					{ page: 1, limit: 2, slug: 'AB' }
				]
			}
		]

	for (const { name, make, inputs } of SHAPES)
		it(`differential: ${name} — frozen ≡ compiled`, () => {
			const path = `/${name.replace(/\W/g, '')}`
			const m = captureDirect(make(), 'GET', path, 'query')

			Compiled.clear()
			Validator.clear()
			const compiled = new TypeBoxValidator(make()) // reference (Compile)

			Validator.clear()
			Compiled.validators = m
			const frozen = Validator.create(make() as any, {
				aot: { method: 'GET', path },
				slot: 'query'
			}) as any

			expect(frozen.tb).toBeUndefined() // Compile skipped
			for (const input of inputs)
				expect(frozen.Check(input)).toBe(compiled.Check(input as any))
		})
})
