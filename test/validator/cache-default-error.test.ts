import { describe, it, expect, afterEach } from 'bun:test'

import { t, validationDetail } from '../../src'
import { Validator } from '../../src/validator'
import { TypeBoxValidator } from '../../src/type/validator'

// Validator cache, default-value, and custom-error regressions.

describe('validator cache, defaults, and custom errors', () => {
	afterEach(() => {
		Validator.clear()
		delete process.env.NODE_ENV
	})

	// a nested object whose OWN default disagrees with a deeper child's
	// default must NOT take the precompute fast path, because applyPrecomputed
	// would bake the object's own default (`{b:2}`) while TypeBox fills the
	// child default (`3`) for a partially-supplied nested object. The handler
	// must receive what TypeBox's authoritative `Default` produces.
	it('divergent nested default is filled per child default, not the parent default', () => {
		const schema = t.Object(
			{
				a: t.Object(
					{ b: t.Number({ default: 3 }) },
					{ default: { b: 2 } }
				)
			},
			{ default: { a: { b: 1 } } }
		)

		const v = new TypeBoxValidator(schema)

		// WHY: the schema-driven merger now bakes this — it recurses per node
		// instead of snapshotting `Default(schema, {})`, so it fills the LEAF
		// default on a present nested object and the parent's own default only
		// when the nested object is absent (the template path bailed here).
		expect(v.precomputeSafe).toBe(true)

		// WHY: `{a:{}}` supplies the nested object but omits `b`; TypeBox fills
		// the LEAF default 3, not the parent object default 2. This is the case
		// the old template precompute path got wrong (it baked the parent default 2).
		expect(v.FromSync({ a: {} })).toEqual({ a: { b: 3 } })

		// `a` absent → it gets its own object default; root present so the root
		// default does not apply. (Matches TypeBox `Default`.)
		expect(v.FromSync({})).toEqual({ a: { b: 2 } })

		// whole value absent → the root object default applies.
		expect(v.FromSync(undefined as any)).toEqual({ a: { b: 1 } })
	})

	// MultiValidator merges two array results. Because `typeof [] ===
	// 'object'`, the object branch used to shadow the array branch and arrays
	// were index-merged via Object.assign (wrong elements + wrong length)
	// instead of concatenated. The array branch must run first.
	it('MultiValidator concatenates arrays instead of index-merging them', () => {
		const standalone = {
			'~standard': {
				version: 1,
				vendor: 'kiana-test',
				// returns an array on validate, mixing with the TypeBox array below
				validate: () => ({ value: ['FROM_STANDALONE'] })
			}
		}

		const mv: any = Validator.create(t.Array(t.String()), {
			schemas: [standalone as any]
		})

		// sanity: this combination produces a MultiValidator (not Intersect).
		expect(mv.constructor.name).toBe('MultiValidator')

		const out = mv.From(['a', 'b', 'c'], 'body') as unknown[]

		// WHY: concat preserves every element from both arrays; the old
		// Object.assign path returned length 3 with index-0 overwritten.
		expect(out).toEqual(['a', 'b', 'c', 'FROM_STANDALONE'])
		expect(out.length).toBe(4)
	})

	// the process-global validator cache is keyed by schema JSON +
	// coercions, but two apps sharing a structurally identical schema with
	// DIFFERENT normalize strategies must not receive each other's validator
	// (their `Clean` differs). The normalize mode must be part of the key.
	it('normalize mode is part of the cache key (no cross-mode aliasing)', () => {
		const vTypebox: any = Validator.create(t.Object({ a: t.String() }), {
			normalize: 'typebox'
		})
		// structurally identical schema, different instance, different mode
		const vMirror: any = Validator.create(t.Object({ a: t.String() }), {
			normalize: 'exactMirror'
		})

		// WHY: different normalize modes must yield distinct validators/Clean.
		expect(vTypebox).not.toBe(vMirror)
		expect(vTypebox.Clean).not.toBe(vMirror.Clean)
	})

	it('identical schema + same normalize mode still shares the cache', () => {
		const a: any = Validator.create(t.Object({ a: t.String() }), {
			normalize: 'exactMirror'
		})
		const b: any = Validator.create(t.Object({ a: t.String() }), {
			normalize: 'exactMirror'
		})

		// WHY: the fix must not defeat caching for the common same-mode case.
		expect(a).toBe(b)
	})

	// a custom `error` on an array's element schema must reach the
	// production 422 payload. collectCustomErrorNodes used to descend only
	// `properties`, never array `items`, so the element error was dropped and
	// production fell back to a generic message (and invoked TypeBox Errors).
	it('custom error on an array element schema surfaces in production', () => {
		process.env.NODE_ENV = 'production'

		const v = new TypeBoxValidator(
			t.Object({
				tags: t.Array(t.String({ error: 'bad tag' }))
			})
		)

		let message: string | undefined
		try {
			v.FromSync({ tags: [123] })
		} catch (error: any) {
			message = error.message
		}

		// WHY: the element's custom message must be surfaced, not a generic one.
		expect(message).toBe('bad tag')
	})

	it('a valid array does not falsely trigger the element custom error', () => {
		process.env.NODE_ENV = 'production'

		const v = new TypeBoxValidator(
			t.Object({
				tags: t.Array(t.String({ error: 'bad tag' }))
			})
		)

		// WHY: the per-element wrap must only fire when an element is invalid;
		// running the element (String) check against the whole array would be a
		// false positive.
		expect(v.FromSync({ tags: ['a', 'b'] })).toEqual({ tags: ['a', 'b'] })
	})

	//  / (union branch, policy 2A) — a custom error inside a
	// discriminated-union branch surfaces ONLY because the value matches that
	// branch's discriminator (`type: 'cat'`) yet fails its constraint. Under the
	// 2A policy the discriminator is what authorises reporting the branch's
	// message; it is no longer an array-order accident.
	it('surfaces a custom error inside a union branch', () => {
		process.env.NODE_ENV = 'production'

		const v = new TypeBoxValidator(
			t.Object({
				pet: t.Union([
					t.Object({
						type: t.Literal('cat'),
						meow: t.Boolean({ error: 'meow must be a boolean' })
					}),
					t.Object({
						type: t.Literal('dog'),
						bark: t.Boolean()
					})
				])
			})
		)

		let message: string | undefined
		try {
			// matches the cat branch's discriminator but meow is wrong type →
			// union rejects → the cat branch's custom error must surface.
			v.FromSync({ pet: { type: 'cat', meow: 'yes' } })
		} catch (error: any) {
			message = error.message
		}

		expect(message).toBe('meow must be a boolean')
	})

	//  (union branch) — the branch gate prevents a false positive: a value
	// valid under a SIBLING branch must NOT trigger the other branch's error.
	it('a value valid under a sibling union branch does not false-trigger', () => {
		process.env.NODE_ENV = 'production'

		const v = new TypeBoxValidator(
			t.Object({
				pet: t.Union([
					t.Object({
						type: t.Literal('cat'),
						meow: t.Boolean({ error: 'meow must be a boolean' })
					}),
					t.Object({
						type: t.Literal('dog'),
						bark: t.Boolean()
					})
				])
			})
		)

		// a perfectly valid dog: the union accepts it, so the cat branch's
		// `meow` custom error must NOT fire.
		expect(v.FromSync({ pet: { type: 'dog', bark: true } })).toEqual({
			pet: { type: 'dog', bark: true }
		})
	})

	// (2A) — the branch actually selected by the discriminator reports ITS
	// OWN custom error, not the first-annotated branch's. Pre- the gate made
	// every branch eligible once the union failed and array order decided, so an
	// invalid dog reported the cat branch's message. With discriminator-based
	// selection the dog value (`type: 'dog'`) must surface the dog error.
	it('an invalid discriminated dog reports the DOG branch error, not the cat one', () => {
		process.env.NODE_ENV = 'production'

		const v = new TypeBoxValidator(
			t.Object({
				pet: t.Union([
					t.Object({
						type: t.Literal('cat'),
						meow: t.Boolean({ error: 'meow must be a boolean' })
					}),
					t.Object({
						type: t.Literal('dog'),
						bark: t.Boolean({ error: 'bark must be a boolean' })
					})
				])
			})
		)

		let message: string | undefined
		try {
			// discriminator says dog, but bark is the wrong type → the dog
			// branch's message must win even though cat is annotated first.
			v.FromSync({ pet: { type: 'dog', bark: 'woof' } })
		} catch (error: any) {
			message = error.message
		}

		expect(message).toBe('bark must be a boolean')
	})

	// When no discriminator disambiguates
	// the branches, the finder must NOT guess a branch's custom message (which
	// it previously selected by array order). It falls back to
	// the deterministic union-level default error. Annotated unions without a
	// discriminator therefore lose the per-branch message they only got by luck.
	it('an ambiguous (no-discriminator) union falls back to the union-level error', () => {
		process.env.NODE_ENV = 'production'

		const v = new TypeBoxValidator(
			t.Object({
				pet: t.Union([
					t.Object({ meow: t.Boolean({ error: 'meow error' }) }),
					t.Object({ bark: t.Boolean({ error: 'bark error' }) })
				])
			})
		)

		let message: string | undefined
		try {
			// invalid under both branches, nothing pins it to one → do not guess.
			v.FromSync({ pet: { meow: 'x' } })
		} catch (error: any) {
			message = error.message
		}

		// WHY: neither branch's custom message may be surfaced; the generic
		// union-level message is the only deterministic answer.
		expect(message).not.toBe('meow error')
		expect(message).not.toBe('bark error')
		expect(message).toContain('Validation error')
	})

	// a property whose NAME contains '/' must be addressed as a single
	// segment. Paths were joined with raw '/' then split, so `a/b` was
	// misaddressed to `a -> b`. Segments are now kept as arrays (output uses
	// RFC 6901 `~1` escaping), so the custom error is found.
	it('a slash-named property surfaces its custom error', () => {
		process.env.NODE_ENV = 'production'

		const v = new TypeBoxValidator(
			t.Object({
				'a/b': t.String({ error: 'slash error' })
			})
		)

		let error: any
		try {
			v.FromSync({ 'a/b': 123 })
		} catch (e: any) {
			error = e
		}

		expect(error?.message).toBe('slash error')
		// the emitted instancePath escapes the slash per JSON Pointer
		expect(error?.errors?.[0]?.instancePath).toBe('/a~1b')
	})

	// a custom error on a property INSIDE homogeneous array items
	// (`rows[].name`) must be traversed. The optimized finder used to descend
	// only the immediate array element error, never nested item properties, so
	// it fell back to a generic message once another custom error enabled it.
	it('a custom error nested in array items (rows[].name) surfaces', () => {
		process.env.NODE_ENV = 'production'

		const v = new TypeBoxValidator(
			t.Object({
				rows: t.Array(
					t.Object({
						name: t.String({ error: 'name error' })
					})
				)
			})
		)

		let message: string | undefined
		try {
			v.FromSync({ rows: [{ name: 123 }] })
		} catch (error: any) {
			message = error.message
		}

		expect(message).toBe('name error')
	})

	// construction must not be quadratic in the number of annotated fields
	// under a union. Pre-, buildFindCustomError recompiled the WHOLE union
	// once per annotated leaf (N annotated fields => N full union compiles),
	// measuring ~203 ms at N=100. A single cached compiled checker per union node
	// makes this near-linear. Loose bound: 2 branches x 100 annotated fields
	// must construct well under the old 203 ms floor.
	it('union custom-error construction is not quadratic in field count', () => {
		process.env.NODE_ENV = 'production'

		const N = 100
		const branchA: Record<string, any> = { type: t.Literal('a') }
		const branchB: Record<string, any> = { type: t.Literal('b') }
		for (let i = 0; i < N; i++) {
			branchA['f' + i] = t.String({ error: 'a' + i })
			branchB['f' + i] = t.String({ error: 'b' + i })
		}

		const schema = t.Object({
			pet: t.Union([t.Object(branchA), t.Object(branchB)])
		})

		const start = performance.now()
		// construction is what compiles the finder; instantiate a few to average
		// out noise without amplifying a linear cost into a false failure.
		for (let i = 0; i < 3; i++) new TypeBoxValidator(schema)
		const elapsed = (performance.now() - start) / 3

		// WHY: a generous ceiling that the quadratic path (~203 ms at N=100 for a
		// SINGLE construction) would blow through, but the cached path clears with
		// wide margin. Kept loose to stay stable across machines/CI.
		expect(elapsed).toBeLessThan(150)
	})

	// isProduction must be read from env at call time, not frozen at
	// module load. A NODE_ENV set AFTER import (serverless cold path / bootstrap)
	// must still gate the schema-revealing validation detail.
	it('production gate reads NODE_ENV lazily (set after import)', () => {
		const v = new TypeBoxValidator(t.Object({ x: t.Number() }))

		// dev: full detail (errors) is exposed
		process.env.NODE_ENV = ''
		let devPayload: any
		try {
			v.FromSync({ x: 'no' })
		} catch (error: any) {
			devPayload = error.payload
		}
		expect(Array.isArray(devPayload.errors)).toBe(true)

		// flip to production AT RUNTIME — the frozen-at-load version could never
		// see this; the lazy getter must.
		process.env.NODE_ENV = 'production'
		let prodPayload: any
		try {
			v.FromSync({ x: 'no' })
		} catch (error: any) {
			prodPayload = error.payload
		}

		// WHY: production must omit schema-revealing detail (no errors/expected/
		// detail).: the failing field's `property` (instance path only — no
		// schema, no messages) IS surfaced so a client can fix their request.
		// `found` is NO LONGER echoed — it reflected the raw request
		// body/query (passwords/tokens/PII) into a structured prod response.
		expect(prodPayload.errors).toBeUndefined()
		expect(prodPayload.expected).toBeUndefined()
		expect(prodPayload.found).toBeUndefined()
		expect(prodPayload.property).toBe('/x')
		expect(Object.keys(prodPayload).sort()).toEqual([
			'on',
			'property',
			'status',
			'title',
			'type'
		])
	})

	// Agreeing nested defaults stay correct even
	// though it now takes the validated path). Guards against a "fix" that
	// returns the wrong value for the agreeing case.
	it('agreeing nested defaults still produce the correct value', () => {
		const schema = t.Object(
			{
				a: t.Object(
					{ b: t.Number({ default: 2 }) },
					{ default: { b: 2 } }
				)
			},
			{ default: { a: { b: 2 } } }
		)

		const v = new TypeBoxValidator(schema)
		expect(v.FromSync({ a: {} })).toEqual({ a: { b: 2 } })
	})
})
