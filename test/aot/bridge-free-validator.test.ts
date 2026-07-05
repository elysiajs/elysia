import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

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
import {
	buildFrozenRouteValidator,
	isBridgeNotInitialized,
	isCapturedBridgeFree
} from '../../src/compile/handler/frozen-validator'

import { materialise } from './_manifest'

/**
 * Bridge-free frozen-validator reconstruction.
 *
 * A build that strips `setupTypebox`/compat severs the TypeBox bridge: the wired
 * `RouteValidator` → `TypeBoxValidator` path throws "Typebox module isn't
 * initialized yet" on its first bridge touch, so the FIRST request to any schema
 * route used to 500. `buildFrozenRouteValidator` rebuilds a validator from the
 * baked manifest ALONE (no bridge, no live TypeBox) for the schema classes whose
 * artifacts are complete, so those routes validate normally under a stripped
 * build.
 *
 * WHY parity matters (not just "it validates"): the bridge-free path must be a
 * drop-in for the wired path on the covered subset. If it produced a different
 * cleaned/coerced value or a different accept/reject decision, a stripped build
 * would silently diverge from a normal build — a correctness regression that no
 * type check would catch. These tests pin wired ≡ bridge-free on real requests.
 *
 * These run in the shared bun process where the bridge IS wired (importing `t`
 * calls `setupTypebox`). That is fine: `buildFrozenRouteValidator` never touches
 * the bridge, so it builds the same validator whether or not the bridge is live.
 * The genuinely-unwired case is pinned out-of-process in
 * `bridge-free-subprocess.test.ts`.
 */

const METHOD = 'POST'
const PATH = '/x'

// Capture a body-slot manifest for `schema`, register it, and return the frozen
// entry so we can build both a wired and a bridge-free validator from it.
function freeze(schema: any) {
	process.env.ELYSIA_AOT_BUILD = '1'
	resetCaptureLifecycleForTests()
	beginValidatorCapture()

	const app = new Elysia().post(PATH, { body: schema }, ({ body }) => body)
	;(app as any).compile()

	const captured = endValidatorCapture()
	endHandlerCapture()
	delete process.env.ELYSIA_AOT_BUILD

	Compiled.clear()
	Validator.clear()
	Compiled.validators = materialise(captured)

	const body = captured.find((c) => c.slot === 'body')

	return { app, body }
}

const hook = (schema: any) => ({ body: schema })
const root = () => new Elysia() as any

// Build the wired validator (real TypeBoxValidator, bridge is live in-process).
const wired = (schema: any) =>
	new RouteValidator(hook(schema) as any, {
		aot: { method: METHOD, path: PATH }
	} as any)

// Build the bridge-free validator directly (never touches the bridge).
const bridgeFree = (schema: any) =>
	buildFrozenRouteValidator(hook(schema) as any, root(), METHOD, PATH)

interface Outcome {
	ok: boolean
	value?: unknown
	status?: number
}

// Run a slot's `From` and normalise the result to a comparable outcome: either a
// success value or the thrown ValidationError's status.
const run = (validator: any, value: unknown): Outcome => {
	try {
		return { ok: true, value: validator.body.From(value, 'body') }
	} catch (error: any) {
		return { ok: false, status: error?.status ?? 500 }
	}
}

// Assert wired ≡ bridge-free for a set of inputs on a given schema.
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
			// identical cleaned/coerced value INCLUDING key order (JSON.stringify
			// is order-sensitive — this catches a Clean-skip divergence).
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

describe('bridge-free frozen validator — parity with the wired path', () => {
	it('plain object with a coerced Numeric (baked into the cm check)', () => {
		assertParity(t.Object({ name: t.String(), age: t.Number() }), [
			{ name: 'a', age: 5 },
			{ name: 'a', age: 5, extra: 'stripped' }, // Clean strips excess
			{ age: 5 }, // missing required → reject
			{ name: 'a', age: 'x' } // wrong type → reject
		])
	})

	it('object with a preallocated default (ps channel)', () => {
		assertParity(
			t.Object({ role: t.String({ default: 'user' }), n: t.Number() }),
			[
				{ n: 1 }, // default fills role
				{ role: 'admin', n: 2 },
				{ role: 5, n: 3 } // wrong type → reject
			]
		)
	})

	it('object with an array of coerced numbers', () => {
		assertParity(t.Object({ xs: t.Array(t.Number()) }), [
			{ xs: [1, 2, 3] },
			{ xs: [] },
			{ xs: ['a'] } // element type mismatch → reject
		])
	})

	it('date codec (slot coercion) is now covered', () => {
		// `t.Date()` is a scalar coercion codec: its decode mirror (ISO/number →
		// Date) and Number|Codec-String union branches reconstruct off the raw
		// schema with no TypeBox. Formerly on the bail list.
		assertParity(t.Object({ when: t.Date() }), [
			{ when: '2024-01-02T03:04:05.000Z' }, // ISO string → Date
			{ when: '2024-01-02' }, // date-only → Date
			{ when: 1704164645000 }, // number → Date
			{ when: 'garbage' } // invalid → reject
		])
	})

	it('optional root object short-circuits before Check', () => {
		assertParity(t.Optional(t.Object({ a: t.String() })), [
			undefined,
			{}, // empty → bypass to {}
			{ a: 'x' },
			{ a: 5 } // wrong type → reject
		])
	})

	it('nested plain object (no codec at any level)', () => {
		assertParity(
			t.Object({ user: t.Object({ name: t.String() }) }),
			[
				{ user: { name: 'a' } },
				{ user: { name: 'a' }, junk: 1 }, // excess stripped
				{ user: {} } // missing nested required → reject
			]
		)
	})
})

describe('bridge-free frozen validator — bail-out matrix', () => {
	// These schema classes need the live schema/TypeBox at request time (unions,
	// codecs, custom errors, closed objects). `buildFrozenRouteValidator` MUST
	// bail (return undefined) so the caller keeps the wired path — never claim a
	// slot is bridge-free when the runtime would then need the bridge.
	const bails: [string, any][] = [
		['union member', t.Object({ v: t.Union([t.String(), t.Number()]) })],
		// NOTE: `t.Date()` USED to bail here. It is now bridge-free — a scalar
		// coercion codec whose decode mirror + union branches reconstruct off the
		// raw schema with no TypeBox (parity pinned in the "date codec (slot
		// coercion) is now covered" test below and in bridge-free-slots.test.ts).
		['ObjectString (inner codec)', t.Object({ f: t.ObjectString({ a: t.Number() }) })],
		['custom error', t.Object({ x: t.String({ error: 'bad' }) })],
		[
			'fully-closed object (Clean-skip parity)',
			t.Object({ a: t.String() }, { additionalProperties: false })
		]
	]

	for (const [name, schema] of bails)
		it(`bails on ${name}`, () => {
			freeze(schema)
			expect(bridgeFree(schema)).toBeUndefined()
		})
})

describe('bridge-free frozen validator — error detection', () => {
	it('recognises only the stripped-bridge error', () => {
		expect(
			isBridgeNotInitialized(
				new Error("Typebox module isn't initialized yet. Import `t`")
			)
		).toBe(true)
		expect(isBridgeNotInitialized(new Error('something else'))).toBe(false)
		expect(isBridgeNotInitialized('not an error')).toBe(false)
	})
})

describe('bridge-free frozen validator — t.NoValidate parity', () => {
	// A `t.NoValidate(...)` slot SKIPS Check in the wired path (#noValidate): a
	// bad-typed value is ACCEPTED, not rejected. The bridge-free path used to run
	// the baked `cm` check unconditionally and 422 — while the capture marker
	// still claimed bridgeFree:true. This pins that the frozen path replicates the
	// wired skip-Check semantics (defaults/optionalBypass/Clean still apply) so a
	// stripped build cannot start rejecting values a normal build accepts.
	it('accepts a bad-typed value on a NoValidate open object, wired ≡ bridge-free', () => {
		assertParity(t.NoValidate(t.Object({ n: t.Number() })), [
			{ n: 5 }, // well-typed
			{ n: 'bad' }, // bad-typed: NoValidate accepts, does NOT 422
			{ n: 5, extra: 'x' } // excess still stripped by Clean
		])
	})
})

describe('bridge-free frozen validator — model ref coherence', () => {
	// Capture a body-slot manifest for a STRING model ref and return both the
	// frozen entry (with its computed bridgeFree marker) and the resolved schema.
	function freezeModelRef(models: Record<string, any>, ref: string) {
		process.env.ELYSIA_AOT_BUILD = '1'
		resetCaptureLifecycleForTests()
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
		Compiled.validators = materialise(captured)

		return captured.find((c) => c.slot === 'body')!
	}

	// A CLOSED object registered as a model, referenced by name. The wired path
	// resolves the ref and skips Clean (#cleanRedundant) on the closed object,
	// preserving input key order. The bridge-free path received the bare string
	// (an object check misses) AND `isFullyClosedObject` false-cycled on the two
	// shared `t.String()` leaves — so it built bridge-free and ran Clean,
	// diverging in key order. Both the marker and the runtime must now REFUSE it.
	it('closed-object model ref → marker false AND runtime bails (no divergence)', () => {
		const models = {
			closed: t.Object(
				{ a: t.String(), b: t.String() },
				{ additionalProperties: false }
			)
		}
		const captured = freezeModelRef(models, 'closed')

		// marker (build-time) must NOT claim bridge-free-completeness
		expect(captured.bridgeFree).toBe(false)
		// and the twin predicate on the raw string ref agrees
		expect(isCapturedBridgeFree(captured, 'closed')).toBe(false)

		// runtime must bail so the caller keeps the wired path (loud, not divergent)
		const root = { '~config': {}, '~ext': { models } } as any
		expect(
			buildFrozenRouteValidator(
				{ body: 'closed' } as any,
				root,
				METHOD as any,
				PATH
			)
		).toBeUndefined()
	})

	// An OPEN object model ref is genuinely bridge-free-complete. It must resolve
	// the ref (so the frozen slot introspects the real object, not the string) and
	// validate identically to the wired path — including key-order normalization
	// via Clean, which the closed case skips.
	it('open-object model ref → builds bridge-free and matches the wired path', () => {
		const models = { open: t.Object({ a: t.String(), b: t.String() }) }
		freezeModelRef(models, 'open')

		const root = { '~config': {}, '~ext': { models } } as any
		const w = new RouteValidator({ body: 'open' } as any, {
			models,
			aot: { method: METHOD, path: PATH }
		} as any)
		const f = buildFrozenRouteValidator(
			{ body: 'open' } as any,
			root,
			METHOD as any,
			PATH
		)

		expect(f, 'open model ref should build bridge-free').toBeDefined()

		for (const input of [
			{ b: 'x', a: 'y' }, // out-of-order keys → Clean normalizes
			{ a: '1', b: '2', junk: 9 } // excess stripped
		]) {
			const wo = run(w, structuredClone(input))
			const fo = run(f, structuredClone(input))
			expect(fo.ok).toBe(wo.ok)
			expect(JSON.stringify(fo.value)).toBe(JSON.stringify(wo.value))
		}
	})

	// An unresolved (unregistered) string ref cannot be validated bridge-free —
	// there is no schema to inspect. The runtime must bail so the wired path
	// surfaces the "reference not found" error loudly instead of silently passing.
	it('unregistered model ref → runtime bails loudly', () => {
		const models = { open: t.Object({ a: t.String() }) }
		freezeModelRef(models, 'open')

		const root = { '~config': {}, '~ext': { models } } as any
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
