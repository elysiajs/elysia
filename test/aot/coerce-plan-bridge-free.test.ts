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
import { clearCoerceLeafCache } from '../../src/type/coerce-plan'

import { materialise } from './_manifest'

/**
 * CoercePlan (`cp`) bridge-free reconstruction.
 *
 * A `t.Number`/`t.Boolean`/`t.Integer` in a query/params/headers root property
 * is COERCED at validator build (`coerceRoot`: Number → Numeric etc.), and a
 * nested object/array in query is coerced to ObjectString/ArrayString — so the
 * raw hook schema is not the schema the frozen closures were captured from.
 * The capture records that delta as a `coercePlan`, and the bridge-free gates
 * used to refuse ANY plan — one `t.Number` in a query flipped an otherwise
 * fully-sealed build (mode A) into wired (mode B), dragging live TypeBox back
 * into the bundle.
 *
 * These pin the fix: scalar sites rebuild through the scalar leaf ctors, and
 * ObjectString/ArrayString sites rebuild as SHAPE nodes whose live closures
 * are replaced by the baked `ic` entries (`reconstructInnerCodecs`) — no
 * `typebox/value` anywhere. A slot whose os nodes DON'T align 1:1 with its
 * `ic` entries (e.g. an inner default refused capture) must keep refusing.
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

describe('ObjectString/ArrayString coercePlan — bridge-free with wired parity', () => {
	it('nested object in query (ObjectString shape + ic reconstruction)', () => {
		assertParity(t.Object({ o: t.Object({ n: t.Number() }) }), [
			{ o: '{"n":1}' }, // JSON string → decoded object
			{ o: { n: 1 } }, // already-parsed branch
			{ o: '{"n":"x"}' }, // inner type mismatch → reject
			{ o: '[1]' }, // wrong opening char → reject
			{ o: 'not json' }, // unparsable → reject
			{} // missing required → reject
		])
	})

	it('nested array in query (ArrayString shape + ic reconstruction)', () => {
		assertParity(t.Object({ xs: t.Array(t.String()) }), [
			{ xs: '["a","b"]' },
			{ xs: '[]' },
			{ xs: '[1]' }, // element mismatch → reject
			{ xs: '{"a":1}' } // wrong opening char → reject
		])
	})

	it('mixed scalar + objstr sites in one plan', () => {
		assertParity(
			t.Object({ n: t.Number(), o: t.Object({ s: t.String() }) }),
			[
				{ n: '1', o: '{"s":"a"}' },
				{ n: '1', o: { s: 'a' } },
				{ n: 'x', o: '{"s":"a"}' }, // scalar reject
				{ n: '1', o: '{"s":1}' } // objstr inner reject
			]
		)
	})

	it('optional nested object (the os site re-attaches ~optional)', () => {
		assertParity(
			t.Object({ o: t.Optional(t.Object({ n: t.Number() })), s: t.String() }),
			[
				{ o: '{"n":1}', s: 'a' },
				{ s: 'a' }, // optional absent
				{ o: 'garbage', s: 'a' } // present but invalid → reject
			]
		)
	})

	it('objstr with inner codec (t.Date inside — ic entry with d.x mirror)', () => {
		assertParity(t.Object({ o: t.Object({ d: t.Date() }) }), [
			{ o: '{"d":"2024-01-02T03:04:05.000Z"}' },
			{ o: '{"d":"garbage"}' }, // inner refine reject
			{ o: { d: '2024-01-02T03:04:05.000Z' } }
		])
	})
})

describe('ic misalignment — still refuses bridge-free', () => {
	it('t.Array(t.Number()) in query (double coercion) → slot stays wired', () => {
		// Query coercion rewrites this BOTH ways: `xs` → ArrayString AND the
		// items t.Number → Numeric inside the array branch. A wholesale `os`
		// site can't express the inner rewrite, so the capture-time
		// `externalsShape` guard drops the plan — no `cp`, but `ic` WAS
		// captured off the coerced schema. Runtime rebuild = raw schema with 0
		// os nodes vs 1 ic entry → alignment refuses.
		const schema = t.Object({ xs: t.Array(t.Number()) })
		const { query } = freeze(schema)

		expect(query?.coercePlan).toBeUndefined()
		expect(query?.innerCodecs?.length).toBe(1)
		expect(query?.bridgeFree).not.toBe(true)
		expect(bridgeFree(schema)).toBeUndefined()
	})

	it('inner default refuses ic capture → slot stays wired', () => {
		// `captureInnerCodec` refuses an inner `default` (not reconstructed
		// under seal), so no `ic` is captured — but the plan still has an os
		// site. 1 shape node vs 0 ic entries → the gate must refuse, or a
		// throwing shape placeholder would go live.
		const schema = t.Object({
			o: t.Object({ n: t.Number({ default: 1 }) })
		})
		const { query } = freeze(schema)

		expect(query?.innerCodecs).toBeUndefined()
		expect(query?.bridgeFree).not.toBe(true)
		expect(bridgeFree(schema)).toBeUndefined()
	})
})

// Capture any slot (query via GET, body via POST) and return its entry.
function freezeSlot(slot: 'query' | 'body', schema: any) {
	process.env.ELYSIA_AOT_BUILD = '1'
	resetCaptureLifecycleForTests()
	beginValidatorCapture()

	const app =
		slot === 'body'
			? new Elysia().post(PATH, { body: schema }, ({ body }) => body)
			: new Elysia().get(PATH, { query: schema }, ({ query }) => query)
	;(app as any).compile()

	const captured = endValidatorCapture()
	endHandlerCapture()
	delete process.env.ELYSIA_AOT_BUILD

	Compiled.clear()
	Validator.clear()
	Compiled.validators = materialise(captured)

	return captured.find((c) => c.slot === slot)
}

describe('unbakeable coercion (cp capture bailed) — refuses instead of crashing', () => {
	// A coercion can fire while `captureCoercePlan` still returns null
	// (unbakeable: coercion inside a union wrapper / tuple, a root-leaf plan,
	// or a non-JSON-safe constraint bag). The baked `cm`/`dm` union tables are
	// then sized for the COERCED schema while the runtime rebuild only has the
	// raw one. Before the `mirrorUnionsAligned` gate these captured
	// `bridgeFree: true` and `buildFrozenRouteValidator` THREW a TypeError
	// inside `buildUnions` — a hard 500 on every request under a sealed strip.
	// NOTE: scalar-inside-Nullable/Union/MaybeEmpty USED to be unbakeable —
	// they now capture a `CoerceUnion` plan and seal (parity pinned in the
	// "union coercePlan" describe below).
	const cases: [string, 'query' | 'body', any][] = [
		[
			'scalar inside Tuple items',
			'query',
			t.Object({ x: t.Tuple([t.Number()]) })
		],
		['root-leaf body coercion', 'body', t.Number()],
		[
			'jsonSafe drop (Infinity in constraint bag)',
			'query',
			t.Object({ n: t.Number({ examples: [Infinity] }) })
		]
	]

	for (const [name, slot, schema] of cases)
		it(`${name} → marker false + clean runtime refusal`, () => {
			const entry = freezeSlot(slot, schema)

			expect(entry?.bridgeFree).not.toBe(true)

			let result: unknown = 'unset'
			expect(() => {
				result = buildFrozenRouteValidator(
					{ [slot]: schema } as any,
					root(),
					slot === 'body' ? 'POST' : 'GET',
					PATH
				)
			}).not.toThrow()
			expect(result).toBeUndefined()
		})
})

describe('union coercePlan (CoerceUnion) — bridge-free with wired parity', () => {
	it('t.Nullable(t.Number()) in query', () => {
		assertParity(t.Object({ n: t.Nullable(t.Number()) }), [
			{ n: '1' },
			{ n: '4.5' },
			{ n: null },
			{ n: 7 },
			{ n: 'x' },
			{ n: '' },
			{}
		])
	})

	it('t.Union([t.Number(), t.String()]) in query', () => {
		assertParity(t.Object({ v: t.Union([t.Number(), t.String()]) }), [
			{ v: '1' },
			{ v: 'hello' },
			{ v: 2 },
			{ v: '' },
			{}
		])
	})

	it('t.MaybeEmpty(t.Number()) in query', () => {
		assertParity(t.Object({ n: t.MaybeEmpty(t.Number()), s: t.String() }), [
			{ n: '1', s: 'a' },
			{ n: '', s: 'a' },
			{ s: 'a' },
			{ n: 'x', s: 'a' }
		])
	})

	it('t.Optional(t.Nullable(t.Number())) (~optional survives the clone)', () => {
		assertParity(
			t.Object({ n: t.Optional(t.Nullable(t.Number())), s: t.String() }),
			[{ n: '1', s: 'a' }, { n: null, s: 'a' }, { s: 'a' }, { n: 'x', s: 'a' }]
		)
	})

	it('constraints inside the nullable branch', () => {
		assertParity(t.Object({ n: t.Nullable(t.Number({ minimum: 2 })) }), [
			{ n: '3' },
			{ n: '1' },
			{ n: null }
		])
	})

	it('nullable nested object (ObjectString branch inside the union)', () => {
		assertParity(t.Object({ o: t.Nullable(t.Object({ s: t.String() })) }), [
			{ o: '{"s":"a"}' },
			{ o: { s: 'a' } },
			{ o: null },
			{ o: 'garbage' },
			{ o: '{"s":1}' }
		])
	})

	it('union site mixed with scalar and objstr sites in one plan', () => {
		assertParity(
			t.Object({
				a: t.Nullable(t.Number()),
				b: t.Number(),
				o: t.Object({ s: t.String() })
			}),
			[
				{ a: '1', b: '2', o: '{"s":"x"}' },
				{ a: null, b: '2', o: { s: 'x' } },
				{ a: 'bad', b: '2', o: '{"s":"x"}' },
				{ a: '1', b: 'bad', o: '{"s":"x"}' }
			]
		)
	})
})
