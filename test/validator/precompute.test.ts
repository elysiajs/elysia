import { describe, expect, it } from 'bun:test'
import { Type } from 'typebox'
import { Default } from 'typebox/value'

import { Elysia, t, ValidationError } from '../../src'
import { TypeBoxValidator } from '../../src/type/validator'
import { setupTypebox } from '../../src/type/compat'
import { req } from '../utils'

// Force the typebox compat module to initialize before constructing
// validators directly (the public `t` proxy normally does this on first
// access).
setupTypebox()

// `TypeBoxValidator.From(value)` should produce the same value as TypeBox's
// runtime `Default(schema, value)` for any input shape, regardless of
// whether the validator's precompute fast path or the fallback runs.
describe('TypeBoxValidator default precompute', () => {
	it('primitive default + undefined input matches Default(schema, undefined)', () => {
		const schema = Type.String({ default: 'foo' })
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(true)
		expect(v.FromSync(undefined as any)).toBe(
			Default(schema, undefined) as any
		)
	})

	it('primitive default + value preserves the value', () => {
		const schema = Type.Number({ default: 42 })
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(true)
		expect(v.FromSync(1 as any)).toBe(Default(schema, 1) as any)
		expect(v.FromSync(1 as any)).toBe(1 as any)
	})

	it('flat object — partial input fills missing leaf defaults', () => {
		const schema = Type.Object({
			a: Type.String({ default: 'a-default' }),
			b: Type.String({ default: 'b-default' })
		})
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(true)
		const out = v.FromSync({ a: 'set' } as any)
		expect(out).toEqual(Default(schema, { a: 'set' }) as any)
		expect(out).toEqual({ a: 'set', b: 'b-default' } as any)
	})

	it('nested object without own default is baked by the schema-driven merger', () => {
		// `Default(schema, {})` does not materialize nested objects that lack
		// their own `default`, so the old value-template snapshot couldn't bake
		// this. The schema-driven merger recurses into `pagination` from the
		// schema and fills leaf defaults on present input — identical to runtime
		// `Default()`.
		const schema = Type.Object({
			pagination: Type.Object({
				limit: Type.Number({ default: 10 }),
				offset: Type.Number({ default: 0 })
			}),
			sort: Type.String({ default: 'asc' })
		})
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(true)
		const out = v.FromSync({ pagination: { limit: 25 } } as any)
		expect(out).toEqual(
			Default(schema, { pagination: { limit: 25 } }) as any
		)
		expect(out).toEqual({
			pagination: { limit: 25, offset: 0 },
			sort: 'asc'
		} as any)
	})

	it('nested object WITH own default uses precompute fast path', () => {
		// When the nested Object carries its own `default`, TypeBox
		// materializes it during the snapshot call. Precompute is safe.
		const schema = Type.Object({
			pagination: Type.Object(
				{
					limit: Type.Number({ default: 10 }),
					offset: Type.Number({ default: 0 })
				},
				{ default: { limit: 10, offset: 0 } }
			),
			sort: Type.String({ default: 'asc' })
		})
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(true)
		const out = v.FromSync({ pagination: { limit: 25 } } as any)
		expect(out).toEqual({
			pagination: { limit: 25, offset: 0 },
			sort: 'asc'
		} as any)
	})

	it('Union schema forces the runtime Default fallback', () => {
		const schema = Type.Union([
			Type.String({ default: 'string-fallback' }),
			Type.Number()
		])
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(false)
		// Still routes through `Default()` and preserves runtime semantics.
		expect(v.FromSync(undefined as any)).toEqual(
			Default(schema, undefined) as any
		)
	})

	it('Codec schema bakes its leaf default; decode still runs in the pipeline', () => {
		const schema = Type.Object({
			id: Type.Codec(Type.String({ default: 'foo' }))
				.Decode((v) => v)
				.Encode((v) => v)
		})
		const v = new TypeBoxValidator(schema)
		// the legacy object-template differential bakes the codec's leaf default;
		// the codec's Decode is unaffected (it runs in the Check/decode pipeline)
		expect(v.precomputeSafe).toBe(true)
		expect(v.FromSync({} as any)).toEqual(Default(schema, {}) as any)
	})

	it('array element object with its own default fills per element', () => {
		// Regression (adversarial review 2026-06-26): `isPrecomputeSafe` returns
		// true for an array whose element object carries its own default, but the
		// old `Default(schema, {})` template could not fill array element defaults
		// — so `{rows:[{}]}` wrongly threw in dev (non-frozen) while an AOT build
		// filled it. The non-frozen path now uses the schema-driven merger and
		// matches runtime `Default()`.
		const schema = Type.Object({
			rows: Type.Array(
				Type.Object(
					{ qty: Type.Number({ default: 1 }) },
					{ default: { qty: 1 } }
				)
			)
		})
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(true)
		const out = v.FromSync({ rows: [{}, { qty: 5 }] } as any)
		expect(out).toEqual(
			Default(schema, { rows: [{}, { qty: 5 }] }) as any
		)
		expect(out).toEqual({ rows: [{ qty: 1 }, { qty: 5 }] } as any)
	})
})

describe('EncodeFrom error path', () => {
	it('codec Encode that throws surfaces as ValidationError', async () => {
		let caught: { isValidation?: boolean; status?: number } | null = null

		const app = new Elysia()
			.error(({ error, set }) => {
				// `code` was removed this version; detect via instanceof.
				caught = {
					isValidation: error instanceof ValidationError,
					status: set.status as number
				}
				return 'caught'
			})
			.get(
				'/',
				{
					response: t.Object({
						id: t
							.Codec(t.String())
							.Decode((v) => v)
							.Encode(() => {
								throw new Error('boom')
							})
					})
				},
				() => ({ id: 'value' })
			)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(422)
		expect(
			(caught as { isValidation?: boolean } | null)?.isValidation
		).toBe(true)
	})
})

describe('t.Cookie field-form ignores `sign` option', () => {
	it("doesn't trigger signing without `secrets` even when `sign` is passed", async () => {
		// Field-form `t.Cookie(schema, { sign })` should NOT auto-sign — the
		// field is signed only when `secrets` is provided. Asserts the
		// contract documented in the t.Cookie implementation.
		const app = new Elysia().get(
			'/',
			{
				cookie: t.Object({
					// `sign` here is intentionally ignored by field-form.
					token: t.Cookie(t.Optional(t.String()), {
						sign: 'token'
					} as any)
				})
			},
			({ cookie: { token } }) => {
				token.value = 'plain'
				return 'ok'
			}
		)

		const setCookie = await app
			.handle(req('/'))
			.then((x) => x.headers.get('set-cookie')!)

		// Plain value, no `.<sig>` suffix.
		expect(setCookie).toContain('token=plain')
		expect(setCookie.split(';')[0]).toBe('token=plain')
	})

	// Regression: the precomputed default is shared across requests.
	// With `normalize:false` there is no Clean() to clone the validated value,
	// so a nested mutable default (e.g. `t.Array(..., { default: [] })`) was
	// handed to every request BY REFERENCE — one request's handler mutation
	// leaked into the next. Each request must get its own default instance.
	it('does not share a defaulted array across requests (normalize:false)', async () => {
		const post = (body: string) =>
			req('/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body
			})

		const app = new Elysia({ normalize: false }).post(
			'/',
			{ body: t.Object({ items: t.Array(t.String(), { default: [] }) }) },
			({ body }) => {
				;(body as { items: string[] }).items.push('x')
				return (body as { items: string[] }).items.length
			}
		)

		// empty object → `items` comes entirely from the (shared) default
		const first = await app.handle(post('{}')).then((r) => r.text())
		const second = await app.handle(post('{}')).then((r) => r.text())

		// before the fix the second request saw the first push (length 2)
		expect(first).toBe('1')
		expect(second).toBe('1')
	})
})

// emitMerger memoization: differential correctness
// Proves that the WeakMap memoization and generated-code single-call
// optimisation changed no output values vs TypeBox's runtime Default().
describe('emitMerger memoization — differential correctness vs Default()', () => {
	// Helper: run FromSync and Default on clones of the same input, assert equal.
	function check(schema: any, inputs: unknown[]) {
		const v = new TypeBoxValidator(schema, { normalize: false })
		expect(v.precomputeSafe).toBe(true)
		for (const input of inputs) {
			const got = v.FromSync(structuredClone(input) as any)
			const want = Default(schema, structuredClone(input))
			expect(got).toEqual(want)
		}
	}

	it('partial nested object fills leaf defaults matching Default()', () => {
		const schema = Type.Object({
			a: Type.Object({ x: Type.Number({ default: 1 }) }),
			b: Type.Object({ y: Type.String({ default: 'hi' }) })
		})
		check(schema, [
			{ a: {}, b: {} },
			{ a: { x: 9 }, b: {} },
			{ a: {}, b: { y: 'bye' } },
			{ a: { x: 2 }, b: { y: 'z' } }
		])
	})

	it('null at a nested key is passed through by the merger (not treated as absent)', () => {
		// The merger must not try to fill defaults inside null — it passes null
		// through unchanged, matching TypeBox Default(schema, {a:null}).
		// Note: TypeBox Check rejects null for an Object type, so we test the
		// merger directly rather than going through FromSync.
		const schema = Type.Object({
			a: Type.Object({ x: Type.Number({ default: 7 }) })
		})

		const { buildObjectDefaultMergeSource, createMergerFromSource } = require(
			'../../src/type/validator/default-precompute'
		)
		// Build a merger for the sub-schema (what would be emitted for "a")
		const subSchema = (schema as any).properties.a
		const subMs = buildObjectDefaultMergeSource({ x: 7 })
		if (subMs) {
			const merger = createMergerFromSource(subMs)
			// null passed to an object merger must return null (not throw, not fill)
			expect(merger(null)).toBeNull()
			expect(merger(undefined)).toBeUndefined()
		}
		// Also verify the whole-schema merger handles null-valued property
		const { verifyPreallocatableDefault } = require(
			'../../src/type/validator/default-precompute'
		)
		const result = verifyPreallocatableDefault(schema)
		if (result?.ms) {
			const merger = createMergerFromSource(result.ms)
			// {a:null} — merger should pass null through for "a" (no filling)
			const out = merger({ a: null })
			expect((out as any).a).toBeNull()
			expect(out).toEqual(Default(schema, { a: null }) as any)
		}
	})

	it('array elements with defaults — each element merged independently', () => {
		const schema = Type.Array(
			Type.Object({ n: Type.Number({ default: 0 }) })
		)
		check(schema, [
			[],
			[{}],
			[{ n: 5 }],
			[{}, { n: 3 }, {}]
		])
	})

	it('deep nesting (3 levels, each with own default) matches Default()', () => {
		// Each nesting level has a leaf default so precomputeSafe applies.
		const schema = Type.Object({
			a: Type.Object({
				b: Type.Object({
					c: Type.Number({ default: 42 })
				}),
				d: Type.Number({ default: 7 })
			}),
			e: Type.String({ default: 'top' })
		})
		check(schema, [
			{ a: { b: {} } },
			{ a: { b: { c: 99 }, d: 0 }, e: 'x' },
			{ a: { b: { c: 1 } } },
			{ a: { b: {} }, e: 'z' }
		])
	})

	it('shared schema sub-object (same reference) is memoised and produces correct output', () => {
		// Using the same sub-schema object as two different properties triggers the
		// WeakMap memoization path. Both properties must still produce correct output.
		const child = Type.Object({ n: Type.Number({ default: 1 }) })
		const schema = Type.Object({ a: child, b: child })
		check(schema, [
			{ a: {}, b: {} },
			{ a: { n: 2 }, b: {} },
			{ a: {}, b: { n: 3 } },
			{ a: { n: 4 }, b: { n: 5 } }
		])
	})

	it('complete input returns same reference (no allocation)', () => {
		const schema = Type.Object({
			a: Type.Object({ x: Type.Number({ default: 1 }) })
		})
		const v = new TypeBoxValidator(schema, { normalize: false })
		expect(v.precomputeSafe).toBe(true)
		const input = { a: { x: 9 } }
		expect(v.FromSync(input as any)).toBe(input as any)
	})
})

// cold-start regression: width-4 depth-7 all-containers-present schema.
//
// IMPORTANT: the schema uses SHARED sub-schema object references so that each
// shared node is compiled exactly once by the WeakMap memo. Without the memo,
// `emitMerger` is called 4^depth times for the leaf — generating ~9 MB of
// merger source — making both `new TypeBoxValidator()` and the first `FromSync`
// extremely slow. With the memo, only 8 unique helpers are emitted (~6 KB).
//
// The test measures `verifyPreallocatableDefault` (the build-time step that
// generates and validates the merger source) because it is the primary cost
// bottleneck: without the fix it takes ~374 ms on an Apple M1 (9 MB `new Function`);
// with the fix it takes ~18 ms (6 KB source). The < 100 ms threshold is safely
// above the post-fix value and well below the pre-fix value.
describe('emitMerger cold-start regression', () => {
	it('width-4 depth-7 shared sub-schemas: merger construction under 100 ms', () => {
		// Build bottom-up with the SAME sub-schema object at each level so the
		// WeakMap memo collapses repeated visits from O(4^depth) to O(depth).
		let layer: any = Type.Object({ leaf: Type.Number({ default: 99 }) })
		for (let d = 0; d < 7; d++) {
			layer = Type.Object({ a: layer, b: layer, c: layer, d: layer })
		}
		const schema = layer

		const { verifyPreallocatableDefault } = require(
			'../../src/type/validator/default-precompute'
		)

		const tStart = performance.now()
		const result = verifyPreallocatableDefault(schema)
		const elapsed = performance.now() - tStart

		// Must produce a valid merger (not undefined)
		expect(result).not.toBeUndefined()
		expect(result?.ms).toBeDefined()

		// < 100 ms: post-fix ~18 ms; pre-fix ~374 ms (9 MB `new Function` compile)
		expect(elapsed).toBeLessThan(100)

		// Verify the merger produces correct output for "all containers present,
		// deepest default absent" (the worst-case for the double-call bug).
		const { createMergerFromSource } = require(
			'../../src/type/validator/default-precompute'
		)
		const merger = createMergerFromSource(result.ms)
		expect(typeof merger).toBe('function')

		function makeInput(depth: number): any {
			if (depth === 0) return {} // leaf default will be filled by merger
			const sub = makeInput(depth - 1)
			return { a: sub, b: sub, c: sub, d: sub }
		}
		const out = merger(makeInput(7)) as any
		expect(out.a.a.a.a.a.a.a.leaf).toBe(99)
	})
})
