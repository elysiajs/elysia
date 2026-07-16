import '../../src/compile/aot-capture'
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
import { clearCoerceLeafCache } from '../../src/type/coerce-plan'

import { materialise } from './_manifest'

/** Captured coercion plans rebuild query schemas without TypeBox. */

const METHOD = 'GET'
const PATH = '/x'

function freeze(schema: any) {
	process.env.ELYSIA_AOT_BUILD = '1'
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
	new RouteValidator(
		hook(schema) as any,
		{
			aot: { method: METHOD, path: PATH }
		} as any
	)

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

function assertParity(schema: any, inputs: unknown[]) {
	const { query } = freeze(schema)

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

describe('scalar coercion plans without TypeBox', () => {
	it('coerces number query values', () => {
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

	it('preserves number constraints', () => {
		assertParity(t.Object({ n: t.Number({ minimum: 2 }) }), [
			{ n: '3' },
			{ n: '1' },
			{ n: 3 },
			{ n: 1 }
		])
	})

	it('coerces boolean and integer query values', () => {
		assertParity(t.Object({ b: t.Boolean(), i: t.Integer() }), [
			{ b: 'true', i: '42' },
			{ b: 'false', i: '0' },
			{ b: 'x', i: '42' },
			{ b: 'true', i: '4.5' }
		])
	})

	it('preserves optional coerced properties', () => {
		assertParity(t.Object({ n: t.Optional(t.Number()), s: t.String() }), [
			{ n: '7', s: 'a' },
			{ s: 'a' },
			{ n: 'x', s: 'a' }
		])
	})

	it('reuses equivalent scalar coercion leaves', () => {
		assertParity(t.Object({ a: t.Number(), b: t.Number() }), [
			{ a: '1', b: '2' },
			{ a: '1', b: 'x' }
		])
	})
})

describe('nested query coercion plans without TypeBox', () => {
	it('decodes object query values', () => {
		assertParity(t.Object({ o: t.Object({ n: t.Number() }) }), [
			{ o: '{"n":1}' },
			{ o: { n: 1 } },
			{ o: '{"n":"x"}' },
			{ o: '[1]' },
			{ o: 'not json' },
			{}
		])
	})

	it('decodes array query values', () => {
		assertParity(t.Object({ xs: t.Array(t.String()) }), [
			{ xs: '["a","b"]' },
			{ xs: '[]' },
			{ xs: '[1]' },
			{ xs: '{"a":1}' }
		])
	})

	it('combines scalar and nested-object coercion', () => {
		assertParity(
			t.Object({ n: t.Number(), o: t.Object({ s: t.String() }) }),
			[
				{ n: '1', o: '{"s":"a"}' },
				{ n: '1', o: { s: 'a' } },
				{ n: 'x', o: '{"s":"a"}' },
				{ n: '1', o: '{"s":1}' }
			]
		)
	})

	it('preserves optional nested objects', () => {
		assertParity(
			t.Object({
				o: t.Optional(t.Object({ n: t.Number() })),
				s: t.String()
			}),
			[{ o: '{"n":1}', s: 'a' }, { s: 'a' }, { o: 'garbage', s: 'a' }]
		)
	})

	it('decodes codecs inside nested objects', () => {
		assertParity(t.Object({ o: t.Object({ d: t.Date() }) }), [
			{ o: '{"d":"2024-01-02T03:04:05.000Z"}' },
			{ o: '{"d":"garbage"}' },
			{ o: { d: '2024-01-02T03:04:05.000Z' } }
		])
	})
})

describe('coercion plans that require TypeBox', () => {
	it('defers arrays with nested number coercion to the wired validator', () => {
		const schema = t.Object({ xs: t.Array(t.Number()) })
		const { query } = freeze(schema)

		expect(query?.coercePlan).toBeUndefined()
		expect(query?.innerCodecs?.length).toBe(1)
		expect(query?.bridgeFree).not.toBe(true)
		expect(bridgeFree(schema)).toBeUndefined()
	})

	it('defers nested defaults to the wired validator', () => {
		const schema = t.Object({
			o: t.Object({ n: t.Number({ default: 1 }) })
		})
		const { query } = freeze(schema)

		expect(query?.innerCodecs).toBeUndefined()
		expect(query?.bridgeFree).not.toBe(true)
		expect(bridgeFree(schema)).toBeUndefined()
	})
})

function freezeSlot(slot: 'query' | 'body', schema: any) {
	process.env.ELYSIA_AOT_BUILD = '1'
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

describe('uncapturable coercion plans', () => {
	const cases: [string, 'query' | 'body', any][] = [
		[
			'scalar inside Tuple items',
			'query',
			t.Object({ x: t.Tuple([t.Number()]) })
		],
		['root body coercion', 'body', t.Number()],
		[
			'non-JSON-safe constraints',
			'query',
			t.Object({ n: t.Number({ examples: [Infinity] }) })
		]
	]

	for (const [name, slot, schema] of cases)
		it(`does not reconstruct ${name}`, () => {
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

describe('union coercion plans without TypeBox', () => {
	it('coerces nullable number query values', () => {
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

	it('coerces number-or-string query values', () => {
		assertParity(t.Object({ v: t.Union([t.Number(), t.String()]) }), [
			{ v: '1' },
			{ v: 'hello' },
			{ v: 2 },
			{ v: '' },
			{}
		])
	})

	it('coerces optional empty number query values', () => {
		assertParity(t.Object({ n: t.MaybeEmpty(t.Number()), s: t.String() }), [
			{ n: '1', s: 'a' },
			{ n: '', s: 'a' },
			{ s: 'a' },
			{ n: 'x', s: 'a' }
		])
	})

	it('preserves optional nullable number properties', () => {
		assertParity(
			t.Object({ n: t.Optional(t.Nullable(t.Number())), s: t.String() }),
			[
				{ n: '1', s: 'a' },
				{ n: null, s: 'a' },
				{ s: 'a' },
				{ n: 'x', s: 'a' }
			]
		)
	})

	it('preserves constraints inside nullable branches', () => {
		assertParity(t.Object({ n: t.Nullable(t.Number({ minimum: 2 })) }), [
			{ n: '3' },
			{ n: '1' },
			{ n: null }
		])
	})

	it('decodes nullable nested objects', () => {
		assertParity(t.Object({ o: t.Nullable(t.Object({ s: t.String() })) }), [
			{ o: '{"s":"a"}' },
			{ o: { s: 'a' } },
			{ o: null },
			{ o: 'garbage' },
			{ o: '{"s":1}' }
		])
	})

	it('combines union, scalar, and nested-object coercion', () => {
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
