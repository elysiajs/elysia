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
import { compileToSource } from '../../src/plugin/aot/source'
import { CheckContext } from 'typebox/schema'
import { Guard } from 'typebox/guard'
import { Format } from 'typebox/format'
import { Hashing } from 'typebox/system'

/** Frozen request validators preserve codec coercion and cleaning. */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

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

describe('frozen request coercion', () => {
	it('coerces and validates query values on a real route', async () => {
		const build = () =>
			new Elysia().get(
				'/q',
				{
					query: t.Object({ page: t.Numeric(), limit: t.Numeric() })
				},
				({ query }) => query
			)

		beginValidatorCapture()
		build().compile()
		const m = materialise(endValidatorCapture())
		expect(m.GET?.['/q']?.query).toBeDefined()

		Validator.clear()
		Compiled.validators = m
		const app = build()
		app.compile()

		const ok = await app.handle(req('/q?page=3&limit=10'))
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ page: 3, limit: 10 })

		const bad = await app.handle(req('/q?page=abc&limit=10'))
		expect(bad.status).toBe(422)
	})

	it('matches runtime decoding without compiling at runtime', () => {
		const make = () =>
			t.Object({
				page: t.Numeric(),
				active: t.BooleanString(),
				when: t.Date()
			})

		const m = captureDirect(make(), 'GET', '/dm', 'query')
		expect(m.GET?.['/dm']?.query?.dm).toBeDefined()

		Compiled.clear()
		Validator.clear()
		const compiled = new TypeBoxValidator(make()) as any

		Validator.clear()
		Compiled.validators = m
		const frozen = Validator.create(make() as any, {
			aot: { method: 'GET', path: '/dm' },
			slot: 'query'
		}) as any

		expect(frozen.tb).toBeUndefined()

		const inputs = [
			{ page: '5', active: 'true', when: '2020-01-02' },
			{ page: '0', active: 'false', when: '2021-06-15' },
			{ page: 12, active: 'true', when: '2020-01-02' }
		]
		for (const input of inputs)
			expect(frozen.FromSync(structuredClone(input))).toEqual(
				compiled.FromSync(structuredClone(input))
			)

		const out = frozen.FromSync({
			page: '7',
			active: 'false',
			when: '2020-01-02'
		})
		expect(out.page).toBe(7)
		expect(out.active).toBe(false)
		expect(out.when).toBeInstanceOf(Date)
	})

	it('uses the frozen decoder for merged check-and-clean validators', () => {
		const make = () => t.Object({ n: t.Numeric() })
		const m = captureDirect(make(), 'GET', '/dmlive', 'query')
		expect(m.GET?.['/dmlive']?.query?.cm).toBeDefined()
		expect(m.GET?.['/dmlive']?.query?.dm).toBeDefined()

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
		expect(dmCalls).toBe(1)
	})

	it('cleans codec values once', () => {
		const v = new TypeBoxValidator(t.Object({ n: t.Numeric() })) as any
		expect(v.hasCodec).toBe(true)
		expect(typeof v.Clean).toBe('function')

		let cleanCalls = 0
		const realClean = v.Clean
		v.Clean = (x: unknown) => {
			cleanCalls++
			return realClean(x)
		}

		const out = v.FromSync({ n: '5', extra: 'x' })
		expect(out).toEqual({ n: 5 })
		expect(cleanCalls).toBe(0)
	})

	it('cleans values when frozen decoder reconstruction fails', () => {
		const make = () => t.Object({ n: t.Numeric() })
		const m = captureDirect(make(), 'GET', '/degrade', 'query')
		expect(m.GET?.['/degrade']?.query?.dm).toBeDefined()

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
		expect(out).toEqual({ n: 5 })
	})

	it('remains valid after a value operation on a shared codec union', () => {
		const make = () => t.Object({ when: t.Date() })
		const m = captureDirect(make(), 'GET', '/reorder', 'query')

		Validator.clear()
		Compiled.validators = m

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

	it('reconstructs emitted validators without runtime compilation', async () => {
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
		const reference = new TypeBoxValidator(make()) as any

		Validator.clear()
		Compiled.validators = validators
		const frozen = new TypeBoxValidator(make() as any, {
			aot: { method: 'GET', path: '/q' },
			slot: 'query'
		}) as any

		expect(frozen.tb).toBeUndefined()

		for (const input of [
			{ page: '5', active: 'true', when: '2024-03-04T05:06:07.000Z' },
			{ page: 9, active: 'false', when: '2021-01-01' }
		])
			expect(frozen.FromSync(structuredClone(input))).toEqual(
				reference.FromSync(structuredClone(input))
			)

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
		it(`${name}: frozen checks match runtime checks`, () => {
			const path = `/${name.replace(/\W/g, '')}`
			const m = captureDirect(make(), 'GET', path, 'query')

			Compiled.clear()
			Validator.clear()
			const compiled = new TypeBoxValidator(make())

			Validator.clear()
			Compiled.validators = m
			const frozen = Validator.create(make() as any, {
				aot: { method: 'GET', path },
				slot: 'query'
			}) as any

			expect(frozen.tb).toBeUndefined()
			for (const input of inputs)
				expect(frozen.Check(input)).toBe(compiled.Check(input as any))
		})
})
