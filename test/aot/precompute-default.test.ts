import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { TypeBoxValidator } from '../../src/type/validator'
import {
	Compiled,
	beginValidatorCapture,
	endValidatorCapture
} from '../../src/compile/aot'
import { compileToSource } from '../../src/plugin/source'
import { materialise } from './_manifest'
import { req } from '../utils'

/**
 * AOT default preallocation — bake `Default(schema, …)` templates into the
 * manifest (`ps`/`pd`/`pod`) so the frozen runtime never calls TypeBox
 * `Default()` at construction. A frozen validator must produce byte-identical
 * `FromSync` output to the JIT validator for every input shape.
 */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const tb = t as any
const PATH = '/p'
const SLOT = 'body' as const

const capture = (schema: any) => {
	beginValidatorCapture()
	new TypeBoxValidator(schema, { aot: { method: 'POST', path: PATH }, slot: SLOT })
	return materialise(endValidatorCapture())
}

const makeFrozen = (schema: any, m: any) => {
	Compiled.clear()
	Validator.clear()
	Compiled.validators = m
	return new TypeBoxValidator(schema, {
		aot: { method: 'POST', path: PATH },
		slot: SLOT
	}) as any
}

const makeJit = (schema: any) => {
	Compiled.clear()
	Validator.clear()
	// same slot/coercion, but no manifest → JIT default path
	return new TypeBoxValidator(schema, {
		aot: { method: 'POST', path: PATH },
		slot: SLOT
	}) as any
}

const entry = (m: any) => m.POST?.[PATH]?.[SLOT]

describe('AOT default preallocation', () => {
	const BAKED: Array<{
		name: string
		make: () => any
		inputs: unknown[]
	}> = [
		{
			name: 'primitive default',
			make: () => t.String({ default: 'foo' }),
			inputs: [undefined, 'set']
		},
		{
			name: 'flat object (isPrecomputeSafe)',
			make: () =>
				t.Object({
					a: t.String({ default: 'a-d' }),
					b: t.String({ default: 'b-d' })
				}),
			inputs: [{}, { a: 'set' }, { a: 'x', b: 'y' }]
		},
		{
			name: 'Numeric default (widening)',
			make: () =>
				t.Object({
					age: t.Numeric({ default: 5 }),
					name: t.String({ default: 'n' })
				}),
			inputs: [{}, { age: 9 }, { name: 'z' }, { age: 1, name: 'q' }]
		},
		{
			name: 'BooleanString default (widening)',
			make: () => t.Object({ b: tb.BooleanString({ default: true }) }),
			inputs: [{}, { b: 'false' }]
		},
		{
			// codec-on-union: now bakes after the createSharedReference cache fix
			name: 'Date default (codec-on-union)',
			make: () => t.Object({ d: t.Date({ default: '2020-01-01' }) }),
			inputs: [{}, { d: '2021-05-05' }, { d: new Date(0) }]
		}
	]

	for (const { name, make, inputs } of BAKED)
		it(`bakes + frozen ≡ JIT: ${name}`, () => {
			const m = capture(make())
			expect(entry(m)?.ps).toBe(1)

			const jit = makeJit(make())
			const frozen = makeFrozen(make(), m)

			expect(frozen.precomputeSafe).toBe(true)

			for (const input of inputs)
				expect(frozen.FromSync(structuredClone(input))).toEqual(
					jit.FromSync(structuredClone(input))
				)
		})

	const NOT_BAKED: Array<{ name: string; make: () => any; inputs: unknown[] }> =
		[
			{
				name: 'nested object without own default',
				make: () =>
					t.Object({
						pg: t.Object({
							limit: t.Number({ default: 10 }),
							offset: t.Number({ default: 0 })
						}),
						s: t.String({ default: 'asc' })
					}),
				inputs: [
					{ pg: { limit: 5 } },
					{ pg: {}, s: 'desc' },
					{ pg: { limit: 1, offset: 2 }, s: 'x' }
				]
			},
			{
				name: 'default inside a union branch',
				make: () =>
					t.Object({
						u: t.Union([
							t.Object({
								kind: t.Literal('a'),
								x: t.String({ default: 'X' })
							}),
							t.Object({
								kind: t.Literal('b'),
								y: t.Number({ default: 9 })
							})
						])
					}),
				inputs: [{ u: { kind: 'a' } }, { u: { kind: 'b' } }]
			}
		]

	for (const { name, make, inputs } of NOT_BAKED)
		it(`does NOT bake (falls back), still frozen ≡ JIT: ${name}`, () => {
			const m = capture(make())
			// not preallocatable → no baked default fields
			expect(entry(m)?.ps).toBeUndefined()

			const jit = makeJit(make())
			const frozen = makeFrozen(make(), m)

			for (const input of inputs)
				expect(frozen.FromSync(structuredClone(input))).toEqual(
					jit.FromSync(structuredClone(input))
				)
		})

	it('baked array default is not shared across requests (H7)', () => {
		const make = () =>
			t.Object({ items: t.Array(t.String(), { default: [] }) })
		const m = capture(make())
		expect(entry(m)?.ps).toBe(1)

		const frozen = makeFrozen(make(), m)

		const first = frozen.FromSync({}) as { items: string[] }
		first.items.push('x')
		const second = frozen.FromSync({}) as { items: string[] }

		expect(first.items).toEqual(['x'])
		expect(second.items).toEqual([]) // independent instance
	})

	// ---- regressions from the adversarial audit (2026-06-19) ----

	it('-0 default is not baked (JSON drops the sign) and -0 is preserved', () => {
		const mk = () => t.Object({ a: t.Number({ default: -0 }) })
		const m = capture(mk())
		// isEmittable rejects -0 → falls back to runtime Default (preserves sign)
		expect(entry(m)?.ps).toBeUndefined()
		const frozen = makeFrozen(mk(), m)
		const jit = makeJit(mk())
		expect(Object.is(frozen.FromSync({}).a, jit.FromSync({}).a)).toBe(true)
	})

	it('baked root-object default with nested array is not shared across requests', () => {
		// root whole-object default → widened + baked; the undefined-input path
		// must deep-clone so a handler mutation never leaks to the next request.
		const mk = () =>
			t.Object(
				{ cfg: t.Object({ list: t.Array(t.Number()) }) },
				{ default: { cfg: { list: [1] } } }
			)
		const frozen = makeFrozen(mk(), capture(mk()))
		const a = frozen.FromSync(undefined) as any
		a.cfg.list.push(99)
		const b = frozen.FromSync(undefined) as any
		expect(b.cfg.list).toEqual([1]) // independent instance
	})

	it('baked default not shared across requests under normalize:false', () => {
		const mk = () =>
			t.Object({ tags: t.Array(t.String()) }, { default: { tags: ['a'] } })
		const m = capture(mk())
		Compiled.clear()
		Validator.clear()
		Compiled.validators = m
		const frozen = new TypeBoxValidator(mk(), {
			aot: { method: 'POST', path: PATH },
			slot: SLOT,
			normalize: false
		}) as any
		const a = frozen.FromSync(undefined) as any
		a.tags.push('LEAK')
		const b = frozen.FromSync(undefined) as any
		expect(b.tags).toEqual(['a']) // not polluted
	})

	it('does NOT widen a bare root codec scalar (null divergence)', () => {
		// t.Numeric as the whole schema: baking would route null→default while
		// JIT Default rejects null → excluded (no object template).
		const m = capture(t.Numeric({ default: 5 }))
		expect(entry(m)?.ps).toBeUndefined()
	})

	it('t.Date no longer drops ~codec / stale default across calls (cache fix)', () => {
		// Regression for the createSharedReference cache-hit bug: the 2nd+
		// `t.Date({default})` used to lose `~codec` (non-enumerable, dropped by
		// Object.assign) and return the FIRST call's default.
		const codec = (s: any) => !!s.properties.d['~codec']
		const def = (s: any) => s.properties.d.default
		expect(codec(t.Object({ d: t.Date({ default: 'a' }) }))).toBe(true)
		expect(codec(t.Object({ d: t.Date({ default: 'a' }) }))).toBe(true)
		expect(def(t.Object({ d: t.Date({ default: '1111-11-11' }) }))).toBe(
			'1111-11-11'
		)
		expect(def(t.Object({ d: t.Date({ default: '2222-02-02' }) }))).toBe(
			'2222-02-02'
		)
	})

	it('frozen validator skips Default() at construction (no tb retained)', () => {
		const make = () => t.Object({ age: t.Numeric({ default: 5 }) })
		const m = capture(make())
		const frozen = makeFrozen(make(), m)
		// check froze too → no TypeBox validator retained
		expect(frozen.tb).toBeUndefined()
		expect(frozen.precomputeSafe).toBe(true)
	})
})

// The real build emitter (`source.ts`) serializes `ps`/`pd`/`pod` as JS literals
// — a separate path from the in-process `materialise` harness.
describe('AOT default preallocation — source emit', () => {
	const build = () =>
		new Elysia().get(
			'/u',
			{
				query: t.Object({
					name: t.String({ default: 'anon' }),
					amount: t.Numeric({ default: 0 })
				})
			},
			({ query }) => query
		)

	const evalManifest = (src: string): any =>
		new Function(
			src
				.replace('export const validators', 'const validators')
				.replace('export const handlers', 'const handlers')
				.replace('export default validators', 'return validators')
				.replace(/^import .*$/gm, '')
		)()

	it('emits valid ps/pd/pod into the manifest', async () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		try {
			const src = await compileToSource(build(), { register: false })
			expect(src).toContain('ps: 1')
			const v = evalManifest(src)
			expect(v.GET['/u'].query.ps).toBe(1)
			expect(v.GET['/u'].query.pod).toEqual({ name: 'anon', amount: 0 })
		} finally {
			delete process.env.ELYSIA_AOT_BUILD
		}
	})

	it('e2e: frozen app fills baked defaults identically to a plain app', async () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		let src: string
		try {
			src = await compileToSource(build(), { register: false })
		} finally {
			delete process.env.ELYSIA_AOT_BUILD
		}

		Validator.clear()
		Compiled.validators = evalManifest(src)
		const frozen = build()
		frozen.compile()

		Compiled.clear()
		Validator.clear()
		const plain = build()
		plain.compile()

		for (const q of ['', '?name=bob', '?amount=42', '?name=x&amount=7']) {
			const f = await frozen.handle(req('/u' + q)).then((r) => r.json())
			const p = await plain.handle(req('/u' + q)).then((r) => r.json())
			expect(f).toEqual(p)
		}
	})
})
