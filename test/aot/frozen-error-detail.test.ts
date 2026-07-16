import '../../src/compile/aot-capture' // installs build-only capture impl (mirrors the AOT plugin)
import { describe, it, expect, afterEach } from 'bun:test'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import {
	Compiled,
	beginValidatorCapture,
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot'
import { RouteValidator } from '../../src/validator/route'
import { buildFrozenRouteValidator } from '../../src/compile/handler/frozen-validator'
import { resetCompactErrorWarnings } from '../../src/compile/aot-capture'

import { materialise } from './_manifest'

/**
 * The frozen (sealed/stripped-bridge) `FrozenSlotValidator.Errors` used to
 * return `[]` unconditionally. On a 422, the wired/live lane names the offending
 * field (`payload.property`, `error.all[i].message`), while the sealed lane
 * returned an empty error list — a SILENT parity gap: a stripped build's 422
 * carried no field detail at all.
 *
 * For open objects, scalars, arrays, and nesting, sealed `.all` must be
 * byte-identical to the wired lane. When a coercion or codec cannot be described
 * faithfully, the build warns once per slot and runtime returns a non-empty,
 * best-effort error naming the offending field. Silent `[]` is never allowed.
 *
 * Each case freezes in isolation (a shared capture Map pollutes cross-schema
 * mirror-union reconstruction — see bridge-free-validator.test.ts).
 */

const METHOD = 'POST'
const PATH = '/x'

// Freeze `schema` as a body slot, capturing any build-time console.warn output.
function freeze(schema: any): { warns: string[] } {
	process.env.ELYSIA_AOT_BUILD = '1'
	resetCompactErrorWarnings()

	const warns: string[] = []
	const original = console.warn
	console.warn = (...args: unknown[]) => warns.push(args.join(' '))

	try {
		beginValidatorCapture()
		const app = new Elysia().post(
			PATH,
			{ body: schema },
			({ body }) => body
		)
		;(app as any).compile()
		const captured = endValidatorCapture()
		endHandlerCapture()

		Compiled.clear()
		Validator.clear()
		Compiled.validators = materialise(captured)
	} finally {
		console.warn = original
		delete process.env.ELYSIA_AOT_BUILD
	}

	return { warns }
}

const hook = (schema: any) => ({ body: schema })
const root = () => new Elysia() as any

const wired = (schema: any) =>
	new RouteValidator(
		hook(schema) as any,
		{
			aot: { method: METHOD, path: PATH }
		} as any
	)

const bridgeFree = (schema: any) =>
	buildFrozenRouteValidator(hook(schema) as any, root(), METHOD, PATH)

// Run `From`, returning the thrown ValidationError (or throw if it unexpectedly
// accepted — the value is always invalid in these cases).
function reject(validator: any, value: unknown): any {
	try {
		validator.From(structuredClone(value), 'body')
	} catch (error) {
		return error
	}
	throw new Error('expected the invalid value to be rejected')
}

afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

describe('sealed validation errors identify offending fields', () => {
	// Differential: sealed `.all` must equal the wired lane byte-for-byte.
	const cases: [string, any, unknown][] = [
		[
			'missing required property',
			t.Object({ name: t.String(), age: t.Number() }),
			{ age: 5 }
		],
		[
			'top-level property type mismatch',
			t.Object({ name: t.String(), age: t.Number() }),
			{ name: 'a', age: 'x' }
		],
		[
			'nested property type mismatch',
			t.Object({ user: t.Object({ name: t.String() }) }),
			{ user: { name: 5 } }
		],
		[
			'nested missing required',
			t.Object({ user: t.Object({ name: t.String() }) }),
			{ user: {} }
		],
		[
			'array element type mismatch',
			t.Object({ xs: t.Array(t.Number()) }),
			{ xs: ['a'] }
		]
	]

	for (const [name, schema, input] of cases)
		it(name, () => {
			freeze(schema)

			const w = wired(schema)
			const f = bridgeFree(schema)
			expect(f, 'schema should be sealed bridge-free').toBeDefined()

			const wErr = reject(w.body, input)
			const fErr = reject(f!.body, input)

			// Failed sealed validation must retain useful field details.
			expect(
				fErr.all.length,
				'sealed error list must not be empty'
			).toBeGreaterThan(0)

			// Field-level parity with the wired lane (path + message + params).
			expect(JSON.stringify(fErr.all)).toBe(JSON.stringify(wErr.all))

			// And the offending field surfaces in the production-safe payload.
			expect(fErr.payload.property).toBe(wErr.payload.property)
		})

	it('keeps the sealed error list non-empty and equal to the wired validator', () => {
		// The old sealed validator returned `[]`, so `fErr.all` was `[]`
		// and this length assertion (and the parity assertion above) FAILED.
		const schema = t.Object({ name: t.String(), age: t.Number() })
		freeze(schema)

		const fErr = reject(bridgeFree(schema)!.body, { age: 5 })

		expect(fErr.all.length).toBeGreaterThan(0)
		expect(fErr.all[0].message).toBe('must have required properties name')
	})
})

describe('sealed coercion and codec errors degrade visibly', () => {
	it('t.Date slot warns at build time and names the field best-effort', () => {
		const schema = t.Object({ when: t.Date() })
		const { warns } = freeze(schema)

		// visible build-time warning (once)
		const aotWarns = warns.filter((w) => w.includes('[elysia-aot]'))
		expect(aotWarns.length).toBe(1)
		expect(aotWarns[0]).toContain('POST /x')
		expect(aotWarns[0]).toContain('body')
		expect(aotWarns[0]).toContain('best-effort')

		const fErr = reject(bridgeFree(schema)!.body, { when: 'garbage' })

		// NON-silent: a best-effort entry naming the offending field, never []
		expect(fErr.all.length).toBeGreaterThan(0)
		expect(fErr.payload.property).toBe('/when')
		expect(fErr.payload.property).not.toBe('root')
	})

	it('t.Numeric slot warns and rejects with a non-empty error', () => {
		const schema = t.Object({ n: t.Numeric() })
		const { warns } = freeze(schema)

		expect(warns.filter((w) => w.includes('[elysia-aot]')).length).toBe(1)

		const fErr = reject(bridgeFree(schema)!.body, { n: 'abc' })
		expect(fErr.all.length).toBeGreaterThan(0)
		expect(fErr.payload.property).toBe('/n')
	})

	it('warning is deduped within one build (once per slot)', () => {
		// Two sealed slots on the SAME codec schema within one capture session
		// warn exactly once per (method,path,slot) — not per property, not per
		// request. The build itself never throws.
		process.env.ELYSIA_AOT_BUILD = '1'
		resetCompactErrorWarnings()

		const warns: string[] = []
		const original = console.warn
		console.warn = (...args: unknown[]) => warns.push(args.join(' '))

		try {
			beginValidatorCapture()
			const app = new Elysia().post(
				PATH,
				{ body: t.Object({ a: t.Date(), b: t.Numeric() }) },
				({ body }) => body
			)
			expect(() => (app as any).compile()).not.toThrow()
			endValidatorCapture()
			endHandlerCapture()
		} finally {
			console.warn = original
			delete process.env.ELYSIA_AOT_BUILD
		}

		// one body slot → one warning, despite two codec properties
		expect(warns.filter((w) => w.includes('[elysia-aot]')).length).toBe(1)
	})
})

describe('sealed structural schemas retain full error details', () => {
	it('plain object/scalar/array schema seals without any warning', () => {
		const { warns } = freeze(
			t.Object({
				name: t.String(),
				age: t.Number(),
				tags: t.Array(t.String())
			})
		)

		expect(warns.filter((w) => w.includes('[elysia-aot]')).length).toBe(0)
	})
})
