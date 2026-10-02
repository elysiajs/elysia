import { afterEach, describe, expect, it } from 'bun:test'
import { Format } from 'typebox/format'
import { Build, Compile } from 'typebox/schema'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { RouteValidator } from '../../src/validator/route'
import { Compiled } from '../../src/compile/aot'
import { alignBuildExternals, reconstructCheck } from '../../src/compile/aot-emit'
import { collectExternals } from '../../src/compile/aot-reconstruct'
import {
	beginValidatorCapture,
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { isAsyncPredicate } from '../../src/type/elysia/file-type'

import { claimManifest, materialise } from './_manifest'

/**
 * TypeBox 1.3.31 passes a lone refinement as `~refine[0]` instead of the
 * array. A frozen check is rebuilt at runtime from the schema
 * (`collectExternals`) without TypeBox, so the capture maps that layout onto
 * the build's. The mapping must never change what the check accepts.
 *
 * 1.3.31 also passes each registered format check as an external function.
 * That cannot be rebuilt from the schema without trusting the runtime format
 * registry, so such a build is never frozen.
 *
 * The hand-written builds below are in the 1.3.31 shape, so they hold on
 * whatever TypeBox the lockfile installs
 */

// what the runtime does: externals rebuilt from the schema alone
const freeze = (build: any, schema: unknown) => {
	const { defs, value } = reconstructCheck(build)

	return new Function(
		'Format',
		build.external.identifier,
		`${defs}; return ${value}`
	)(Format, collectExternals(schema)) as (value: unknown) => boolean
}

const shape = (functions: string, variables: unknown[]) => ({
	functions: [functions],
	entry: 'check_0(value)',
	useUnevaluated: false,
	external: { identifier: 'External', variables }
})

describe('TypeBox build external layout', () => {
	const schema = t.Object({
		b: t.Refine(t.String(), (value) => value.length > 1),
		c: t.Refine(
			t.Refine(t.Number(), (value) => value > 1),
			(value) => value < 9
		)
	}) as any

	const build = shape(
		'const check_0 = (value) => (typeof value === "object" && value !== null' +
			' && External[0].check(value.b)' +
			' && External[1].every((refinement, _) => refinement.check(value.c)))',
		[schema.properties.b['~refine'][0], schema.properties.c['~refine']]
	)

	it('maps a 1.3.31 lone refinement onto the runtime layout', () => {
		const canonical = alignBuildExternals(build, schema)!
		expect(canonical).toBeDefined()

		// TypeBox's own code is never edited
		expect(canonical.functions.slice(1)).toEqual(build.functions)
		expect(canonical.entry).toBe(build.entry)

		const check = freeze(canonical, schema)
		const valid = { b: 'ok', c: 5 }

		expect(check(valid)).toBe(true)
		expect(check({ ...valid, b: 'k' })).toBe(false)
		expect(check({ ...valid, c: 1 })).toBe(false)
		expect(check({ ...valid, c: 9 })).toBe(false)
	})

	// The frozen check would look the format up in whatever registry the
	// runtime has: a missing or replaced registration flips what it accepts
	it('never freezes a 1.3.31 format check', () => {
		const email = t.Object({ a: t.String({ format: 'email' }) }) as any

		expect(
			alignBuildExternals(
				shape(
					'const check_0 = (value) => (typeof value === "object" && value !== null' +
						' && External[0](value.a))',
					[Format.Get('email')]
				),
				email
			)
		).toBeUndefined()
	})

	// A property named like the externals identifier: `value.External[1]` is
	// user data, not an external. Rewriting the generated source turned it
	// into `value.External[0][0]` and accepted a value the build rejects
	it('does not touch user data named like the externals identifier', () => {
		const user = t.Object({
			External: t.Tuple([
				t.Any(),
				t.Refine(t.String(), (x) => x === 'good')
			])
		}) as any

		const check = freeze(
			alignBuildExternals(
				shape(
					'const check_0 = (value) => (typeof value === "object" && value !== null' +
						' && Array.isArray(value.External)' +
						' && External[0].check(value.External[1]))',
					[user.properties.External.items[1]['~refine'][0]]
				),
				user
			)!,
			user
		)

		expect(check({ External: [['good'], 42] })).toBe(false)
		expect(check({ External: [0, 'good'] })).toBe(true)
	})

	it('leaves a build already in the runtime layout untouched', () => {
		const old = shape(build.functions[0], collectExternals(schema))

		expect(alignBuildExternals(old, schema)).toBe(old)
	})

	it('refuses externals the schema cannot reproduce', () => {
		const foreign = (variables: unknown[]) =>
			alignBuildExternals(shape(build.functions[0], variables), schema)

		const [b, c] = build.external.variables

		// an extra value, a refinement the schema does not hold, a function
		expect(foreign([b, c, /x/])).toBeUndefined()
		expect(
			foreign([{ check: () => true, error: () => '' }, c])
		).toBeUndefined()
		expect(foreign([() => true, b, c])).toBeUndefined()
	})

	// a lone async refinement would otherwise read as synchronous, and the
	// validator would skip the queue it has to await
	it('sees an async check on a lone refinement', () => {
		const check = () => true
		;(check as any)['~elyAsyncRefine'] = true

		expect(isAsyncPredicate({ check, error: () => '' })).toBe(true)
		expect(isAsyncPredicate([{ check, error: () => '' }])).toBe(true)
		expect(isAsyncPredicate({ check: () => true, error: () => '' })).toBe(
			false
		)
	})
})

// Against the installed TypeBox: the frozen check must agree with TypeBox's
// own compiled check, whatever the property names look like
describe('frozen check parity with the installed TypeBox', () => {
	const good = (x: string) => x === 'good'

	for (const name of [
		'External',
		'Format',
		'$External',
		'External[0]',
		'External[1].check(',
		'"External"',
		'Éxtérnal',
		'外部'
	])
		for (const email of [false, true]) {
			const schema = t.Object({
				...(email ? { email: t.String({ format: 'email' }) } : {}),
				[name]: t.Tuple([t.Any(), t.Refine(t.String(), good)]),
				single: t.Refine(t.String(), good),
				many: t.Refine(
					t.Refine(t.String(), good),
					(x) => x.length === 4
				)
			}) as any

			it(`agrees for a property named ${JSON.stringify(name)}${email ? ' beside a format' : ''}`, () => {
				const build = Build(schema) as any
				const canonical = alignBuildExternals(build, schema)

				// a build that passes a format check as an external is not frozen
				if (
					build.external.variables.some(
						(v: unknown) => typeof v === 'function'
					)
				)
					return expect(canonical).toBeUndefined()

				expect(canonical).toBeDefined()

				const frozen = freeze(canonical, schema)
				const compiled = Compile(schema)

				const base = { email: 'a@b.co', single: 'good', many: 'good' }
				for (const value of [
					{ ...base, [name]: [0, 'good'] },
					{ ...base, [name]: [['good'], 42] },
					{ ...base, [name]: [0, 'bad'] },
					{ ...base, [name]: [0, 'good'], email: 'nope' },
					{ ...base, [name]: [0, 'good'], single: 'bad' },
					{ ...base, [name]: [0, 'good'], many: 'bad' },
					{ ...base, [name]: 'good' }
				])
					expect(frozen(value)).toBe(compiled.Check(value))
			})
		}
})

// End to end on the installed TypeBox: whether or not the format check could
// be frozen, the captured route must still reject a bad email
describe('format route through the AOT capture', () => {
	afterEach(() => {
		delete process.env.ELYSIA_AOT_BUILD
		Compiled.clear()
		Validator.clear()
	})

	it('validates the format on the frozen or the TypeBox path', () => {
		const schema = t.Object({ email: t.String({ format: 'email' }) })

		process.env.ELYSIA_AOT_BUILD = '1'
		beginValidatorCapture()
		;(
			new Elysia().get(
				'/x',
				{ query: schema },
				({ query }) => query
			) as any
		).compile()
		const captured = endValidatorCapture()
		endHandlerCapture()
		delete process.env.ELYSIA_AOT_BUILD

		const query = captured.find((c) => c.slot === 'query')!
		const externalized = (Build(schema) as any).external.variables.some(
			(v: unknown) => typeof v === 'function'
		)
		// 1.3.31+ is never frozen; older TypeBox freezes `Format.Test(...)`
		expect(query.checkValue === undefined).toBe(externalized)

		Compiled.clear()
		Validator.clear()
		const app = claimManifest({ validators: materialise(captured) })
		const validator = new RouteValidator(
			{ query: schema } as any,
			{ aot: { method: 'GET', path: '/x' }, app } as any
		) as any

		expect(validator.query.From({ email: 'a@b.co' }, 'query')).toEqual({
			email: 'a@b.co'
		})
		expect(() => validator.query.From({ email: 'nope' }, 'query')).toThrow()
	})
})
