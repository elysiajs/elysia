import '../../src/compile/aot-capture'
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled, type ProgramId } from '../../src/compile/aot'
import {
	beginValidatorCapture,
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot-capture'
import { RouteValidator } from '../../src/validator/route'
import {
	buildFrozenRouteValidator,
	isBridgeNotInitialized,
	isCapturedBridgeFree
} from '../../src/compile/handler/frozen-validator'

import { claimManifest, materialise } from './_manifest'

/** Frozen validators must match wired validation without using TypeBox. */

const METHOD = 'POST'
const PATH = '/x'

function freeze(schema: any) {
	process.env.ELYSIA_AOT_BUILD = '1'
	beginValidatorCapture()

	const app = new Elysia().post(PATH, { body: schema }, ({ body }) => body)
	;(app as any).compile()

	const captured = endValidatorCapture()
	endHandlerCapture()
	delete process.env.ELYSIA_AOT_BUILD

	Compiled.clear()
	Validator.clear()
	claimed = claimManifest({ validators: materialise(captured) })

	const body = captured.find((c) => c.slot === 'body')

	return { app, body }
}

// program claimed by the latest `freeze()`/`freezeModelRef()`
let claimed: { ['~programId']: ProgramId }

const hook = (schema: any) => ({ body: schema })
const root = () => claimed as any

const wired = (schema: any) =>
	new RouteValidator(
		hook(schema) as any,
		{
			aot: { method: METHOD, path: PATH },
			app: claimed
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
		return { ok: true, value: validator.body.From(value, 'body') }
	} catch (error: any) {
		return { ok: false, status: error?.status ?? 500 }
	}
}

function assertParity(schema: any, inputs: unknown[]) {
	freeze(schema)

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
				`cleaned value parity for ${JSON.stringify(input)}`
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
})

describe('frozen validation without TypeBox', () => {
	it('matches wired validation for a coerced object', () => {
		assertParity(t.Object({ name: t.String(), age: t.Number() }), [
			{ name: 'a', age: 5 },
			{ name: 'a', age: 5, extra: 'stripped' },
			{ age: 5 },
			{ name: 'a', age: 'x' }
		])
	})

	it('applies defaults before validation', () => {
		assertParity(
			t.Object({ role: t.String({ default: 'user' }), n: t.Number() }),
			[{ n: 1 }, { role: 'admin', n: 2 }, { role: 5, n: 3 }]
		)
	})

	it('validates arrays of coerced numbers', () => {
		assertParity(t.Object({ xs: t.Array(t.Number()) }), [
			{ xs: [1, 2, 3] },
			{ xs: [] },
			{ xs: ['a'] }
		])
	})

	it('decodes date values', () => {
		assertParity(t.Object({ when: t.Date() }), [
			{ when: '2024-01-02T03:04:05.000Z' },
			{ when: '2024-01-02' },
			{ when: 1704164645000 },
			{ when: 'garbage' }
		])
	})

	it('decodes nested objects from string values', () => {
		assertParity(t.Object({ f: t.ObjectString({ a: t.Number() }) }), [
			{ f: '{"a":1}' },
			{ f: { a: 1 } },
			{ f: '{"a":"x"}' },
			{ f: '[1]' },
			{ f: 'not json' }
		])
	})

	it('preserves optional root behavior', () => {
		assertParity(t.Optional(t.Object({ a: t.String() })), [
			undefined,
			{},
			{ a: 'x' },
			{ a: 5 }
		])
	})

	it('validates nested objects', () => {
		assertParity(t.Object({ user: t.Object({ name: t.String() }) }), [
			{ user: { name: 'a' } },
			{ user: { name: 'a' }, junk: 1 },
			{ user: {} }
		])
	})
})

describe('schemas that require TypeBox', () => {
	const unsupported: [string, any][] = [
		['union member', t.Object({ v: t.Union([t.String(), t.Number()]) })],
		['custom error', t.Object({ x: t.String({ error: 'bad' }) })],
		[
			'fully closed object',
			t.Object({ a: t.String() }, { additionalProperties: false })
		]
	]

	for (const [name, schema] of unsupported)
		it(`does not reconstruct a ${name}`, () => {
			freeze(schema)
			expect(bridgeFree(schema)).toBeUndefined()
		})
})

describe('missing TypeBox bridge detection', () => {
	it('matches only bridge initialization errors', () => {
		expect(
			isBridgeNotInitialized(
				new Error("Typebox module isn't initialized yet. Import `t`")
			)
		).toBe(true)
		expect(isBridgeNotInitialized(new Error('something else'))).toBe(false)
		expect(isBridgeNotInitialized('not an error')).toBe(false)
	})
})

describe('NoValidate without TypeBox', () => {
	it('skips type checks while preserving cleaning behavior', () => {
		assertParity(t.NoValidate(t.Object({ n: t.Number() })), [
			{ n: 5 },
			{ n: 'bad' },
			{ n: 5, extra: 'x' }
		])
	})
})

describe('model references without TypeBox', () => {
	function freezeModelRef(models: Record<string, any>, ref: string) {
		process.env.ELYSIA_AOT_BUILD = '1'
		beginValidatorCapture()

		const app = new Elysia()
			.model(models)
			.post(PATH, { body: ref as any }, ({ body }) => body)
		;(app as any).compile()

		const captured = endValidatorCapture()
		endHandlerCapture()
		delete process.env.ELYSIA_AOT_BUILD

		Compiled.clear()
		Validator.clear()
		claimed = claimManifest({ validators: materialise(captured) })

		return captured.find((c) => c.slot === 'body')!
	}

	it('defers closed-object references to the wired validator', () => {
		const models = {
			closed: t.Object(
				{ a: t.String(), b: t.String() },
				{ additionalProperties: false }
			)
		}
		const captured = freezeModelRef(models, 'closed')

		expect(captured.bridgeFree).toBe(false)
		expect(isCapturedBridgeFree(captured, 'closed')).toBe(false)

		const root = { ...claimed, '~config': {}, '~ext': { models } } as any
		expect(
			buildFrozenRouteValidator(
				{ body: 'closed' } as any,
				root,
				METHOD as any,
				PATH
			)
		).toBeUndefined()
	})

	it('reconstructs open-object references with matching cleaning', () => {
		const models = { open: t.Object({ a: t.String(), b: t.String() }) }
		freezeModelRef(models, 'open')

		const root = { ...claimed, '~config': {}, '~ext': { models } } as any
		const w = new RouteValidator(
			{ body: 'open' } as any,
			{
				models,
				aot: { method: METHOD, path: PATH },
				app: claimed
			} as any
		)
		const f = buildFrozenRouteValidator(
			{ body: 'open' } as any,
			root,
			METHOD as any,
			PATH
		)

		expect(f, 'open model ref should build bridge-free').toBeDefined()

		for (const input of [
			{ b: 'x', a: 'y' },
			{ a: '1', b: '2', junk: 9 }
		]) {
			const wo = run(w, structuredClone(input))
			const fo = run(f, structuredClone(input))
			expect(fo.ok).toBe(wo.ok)
			expect(JSON.stringify(fo.value)).toBe(JSON.stringify(wo.value))
		}
	})

	it('defers unknown model references to the wired validator', () => {
		const models = { open: t.Object({ a: t.String() }) }
		freezeModelRef(models, 'open')

		const root = { ...claimed, '~config': {}, '~ext': { models } } as any
		expect(
			buildFrozenRouteValidator(
				{ body: 'missing' } as any,
				root,
				METHOD as any,
				PATH
			)
		).toBeUndefined()
	})
})
