import { describe, it, expect, afterEach } from 'bun:test'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import {
	Compiled,
	beginValidatorCapture,
	endValidatorCapture,
	endHandlerCapture,
	resetCaptureLifecycleForTests
} from '../../src/compile/aot'
import { RouteValidator } from '../../src/validator/route'
import { buildFrozenRouteValidator } from '../../src/compile/handler/frozen-validator'
import {
	planIsScalarOnly,
	clearCoerceLeafCache,
	type CoercePlan
} from '../../src/type/coerce-plan'

import { materialise } from './_manifest'

/**
 * Scalar CoercePlan (`cp`) bridge-free reconstruction.
 *
 * A `t.Number`/`t.Boolean`/`t.Integer` in a query/params/headers root property
 * is COERCED at validator build (`coerceRoot`: Number → Numeric etc.), so the
 * raw hook schema is not the schema the frozen closures were captured from.
 * The capture records that delta as a `coercePlan`, and the bridge-free gates
 * used to refuse ANY plan — one `t.Number` in a query flipped an otherwise
 * fully-sealed build (mode A) into wired (mode B), dragging live TypeBox back
 * into the bundle.
 *
 * These pin the fix: a SCALAR-only plan rebuilds the coerced schema TypeBox-
 * free (`buildCoercedFromPlan`, scalar leaves only) and stays bridge-free with
 * full wired-parity, while a plan containing an ObjectString/ArrayString site
 * still refuses (its rebuild needs `typebox/value`).
 */

const METHOD = 'GET'
const PATH = '/x'

// Capture a query-slot manifest for `schema` (query is a root-properties
// coercion slot), register it, and return the captured entry.
function freeze(schema: any) {
	process.env.ELYSIA_AOT_BUILD = '1'
	resetCaptureLifecycleForTests()
	beginValidatorCapture()

	const app = new Elysia().get(PATH, { query: schema }, ({ query }) => query)
	;(app as any).compile()

	const captured = endValidatorCapture()
	endHandlerCapture()
	delete process.env.ELYSIA_AOT_BUILD

	Compiled.clear()
	Validator.clear()
	Compiled.validators = materialise(captured)

	return { query: captured.find((c) => c.slot === 'query') }
}

const hook = (schema: any) => ({ query: schema })
const root = () => new Elysia() as any

const wired = (schema: any) =>
	new RouteValidator(hook(schema) as any, {
		aot: { method: METHOD, path: PATH }
	} as any)

const bridgeFree = (schema: any) =>
	buildFrozenRouteValidator(hook(schema) as any, root(), METHOD, PATH)

interface Outcome {
	ok: boolean
	value?: unknown
	status?: number
}

const run = (validator: any, value: unknown): Outcome => {
	try {
		return { ok: true, value: validator.query.From(value, 'query') }
	} catch (error: any) {
		return { ok: false, status: error?.status ?? 500 }
	}
}

// Assert wired ≡ bridge-free for a set of query objects on a given schema.
function assertParity(schema: any, inputs: unknown[]) {
	const { query } = freeze(schema)

	// the schema classes here MUST capture a plan — that is the case under test
	expect(query?.coercePlan, 'expected a coercePlan capture').toBeDefined()
	expect(query?.bridgeFree, 'expected the slot to be bridge-free').toBe(true)

	const w = wired(schema)
	const f = bridgeFree(schema)

	expect(f, 'expected schema to be reconstructed bridge-free').toBeDefined()

	for (const input of inputs) {
		const wo = run(w, structuredClone(input))
		const fo = run(f, structuredClone(input))

		expect(fo.ok, `accept/reject parity for ${JSON.stringify(input)}`).toBe(
			wo.ok
		)

		if (wo.ok)
			expect(
				JSON.stringify(fo.value),
				`decoded value parity for ${JSON.stringify(input)}`
			).toBe(JSON.stringify(wo.value))
		else
			expect(
				fo.status,
				`reject status parity for ${JSON.stringify(input)}`
			).toBe(wo.status)
	}
}

afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
	clearCoerceLeafCache()
})

describe('planIsScalarOnly', () => {
	it('accepts scalar-leaf plans, flat and nested', () => {
		expect(planIsScalarOnly({ p: { a: { e: 1 } } })).toBe(true)
		expect(planIsScalarOnly({ i: { e: 2 } })).toBe(true)
		expect(
			planIsScalarOnly({ p: { a: { p: { b: { e: 3 } } } } } as CoercePlan)
		).toBe(true)
	})

	it('refuses any ObjectString/ArrayString site, however deep', () => {
		expect(planIsScalarOnly({ p: { a: { os: 1 } } })).toBe(false)
		expect(planIsScalarOnly({ i: { os: 2 } })).toBe(false)
		expect(
			planIsScalarOnly({
				p: { a: { p: { b: { os: 1 } } } }
			} as CoercePlan)
		).toBe(false)
	})
})

describe('scalar coercePlan — bridge-free with wired parity', () => {
	it('t.Number in query (the Numeric coercion)', () => {
		assertParity(t.Object({ name: t.Number() }), [
			{ name: '42' },
			{ name: '4.5' },
			{ name: 42 },
			{ name: 'abc' },
			{ name: '' },
			{},
			{ name: '1e3' }
		])
	})

	it('t.Number with constraints (the plan carries the options bag)', () => {
		assertParity(t.Object({ n: t.Number({ minimum: 2 }) }), [
			{ n: '3' },
			{ n: '1' },
			{ n: 3 },
			{ n: 1 }
		])
	})

	it('t.Boolean and t.Integer in query', () => {
		assertParity(t.Object({ b: t.Boolean(), i: t.Integer() }), [
			{ b: 'true', i: '42' },
			{ b: 'false', i: '0' },
			{ b: 'x', i: '42' },
			{ b: 'true', i: '4.5' }
		])
	})

	it('optional coerced property (the plan re-attaches ~optional)', () => {
		assertParity(
			t.Object({ n: t.Optional(t.Number()), s: t.String() }),
			[{ n: '7', s: 'a' }, { s: 'a' }, { n: 'x', s: 'a' }]
		)
	})

	it('repeated identical leaves (leaf cache / seen dedupe semantics)', () => {
		assertParity(t.Object({ a: t.Number(), b: t.Number() }), [
			{ a: '1', b: '2' },
			{ a: '1', b: 'x' }
		])
	})
})

describe('non-scalar coercePlan — still refuses bridge-free', () => {
	it('nested object in query (ObjectString site)', () => {
		const schema = t.Object({ o: t.Object({ n: t.Number() }) })
		const { query } = freeze(schema)

		expect(query?.bridgeFree).not.toBe(true)
		expect(bridgeFree(schema)).toBeUndefined()
	})

	it('nested array in query (ArrayString site)', () => {
		const schema = t.Object({ xs: t.Array(t.String()) })
		const { query } = freeze(schema)

		expect(query?.bridgeFree).not.toBe(true)
		expect(bridgeFree(schema)).toBeUndefined()
	})
})
