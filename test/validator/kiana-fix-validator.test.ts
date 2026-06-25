import { describe, it, expect, afterEach } from 'bun:test'

import { t, validationDetail } from '../../src'
import { Validator } from '../../src/validator'
import { TypeBoxValidator } from '../../src/type/validator'

// Regression tests for the kiana validator-group fixes (idx 16, 17, 18, 33, 49).
// Each test fails on the pre-fix code and passes after.

describe('kiana validator fixes', () => {
	afterEach(() => {
		Validator.clear()
		delete process.env.NODE_ENV
	})

	// idx16 — a nested object whose OWN default disagrees with a deeper child's
	// default must NOT take the precompute fast path, because applyPrecomputed
	// would bake the object's own default (`{b:2}`) while TypeBox fills the
	// child default (`3`) for a partially-supplied nested object. The handler
	// must receive what TypeBox's authoritative `Default` produces.
	it('idx16 — divergent nested default is filled per child default, not the parent default', () => {
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

	// idx17 — MultiValidator merges two array results. Because `typeof [] ===
	// 'object'`, the object branch used to shadow the array branch and arrays
	// were index-merged via Object.assign (wrong elements + wrong length)
	// instead of concatenated. The array branch must run first.
	it('idx17 — MultiValidator concatenates arrays instead of index-merging them', () => {
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

	// idx18 — the process-global validator cache is keyed by schema JSON +
	// coercions, but two apps sharing a structurally identical schema with
	// DIFFERENT normalize strategies must not receive each other's validator
	// (their `Clean` differs). The normalize mode must be part of the key.
	it('idx18 — normalize mode is part of the cache key (no cross-mode aliasing)', () => {
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

	it('idx18 — identical schema + same normalize mode still shares the cache', () => {
		const a: any = Validator.create(t.Object({ a: t.String() }), {
			normalize: 'exactMirror'
		})
		const b: any = Validator.create(t.Object({ a: t.String() }), {
			normalize: 'exactMirror'
		})

		// WHY: the fix must not defeat caching for the common same-mode case.
		expect(a).toBe(b)
	})

	// idx33 — a custom `error` on an array's element schema must reach the
	// production 422 payload. collectCustomErrorNodes used to descend only
	// `properties`, never array `items`, so the element error was dropped and
	// production fell back to a generic message (and invoked TypeBox Errors).
	it('idx33 — custom error on an array element schema surfaces in production', () => {
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

	it('idx33 — a valid array does not falsely trigger the element custom error', () => {
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

	// idx33 (union branch) — a custom error inside a discriminated-union branch
	// surfaces when the value matches that branch's discriminator but fails its
	// constraint, and the whole union therefore rejects.
	it('idx33 — surfaces a custom error inside a union branch', () => {
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

	// idx33 (union branch) — the branch gate prevents a false positive: a value
	// valid under a SIBLING branch must NOT trigger the other branch's error.
	it('idx33 — a value valid under a sibling union branch does not false-trigger', () => {
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

	// idx49 — isProduction must be read from env at call time, not frozen at
	// module load. A NODE_ENV set AFTER import (serverless cold path / bootstrap)
	// must still gate the schema-revealing validation detail.
	it('idx49 — production gate reads NODE_ENV lazily (set after import)', () => {
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

		// WHY: production must omit schema-revealing detail.
		expect(prodPayload.errors).toBeUndefined()
		expect(Object.keys(prodPayload).sort()).toEqual(['found', 'on', 'type'])
	})

	// idx16 control — agreeing nested defaults stay correct (value is right even
	// though it now takes the validated path). Guards against a "fix" that
	// returns the wrong value for the agreeing case.
	it('idx16 control — agreeing nested defaults still produce the correct value', () => {
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
