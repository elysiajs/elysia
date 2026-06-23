import { describe, it, expect } from 'bun:test'
import { t } from '../../src'
import { shallowMergeObjects } from '../../src/type/validator'
import { Evaluate, Intersect } from 'typebox/type'
import { Check, Decode, Errors } from 'typebox/value'

const decode = (s: any, v: unknown) => {
	try {
		return JSON.stringify(Decode(s, v))
	} catch {
		return 'THROW'
	}
}

const expectEquivalent = (mk: () => any[], values: unknown[]) => {
	const fast = shallowMergeObjects(mk())
	expect(fast).not.toBeNull()
	const slow = Evaluate(Intersect(mk() as any))

	expect(Object.keys((fast as any).properties).sort()).toEqual(
		Object.keys((slow as any).properties).sort()
	)
	expect([...((fast as any).required ?? [])].sort()).toEqual(
		[...((slow as any).required ?? [])].sort()
	)

	for (const v of values) {
		expect(Check(fast as any, v)).toBe(Check(slow as any, v))
		expect([...Errors(fast as any, v)].length).toBe(
			[...Errors(slow as any, v)].length
		)
		expect(decode(fast, v)).toBe(decode(slow, v))
	}
}

describe('shallowMergeObjects fires and equals Evaluate(Intersect)', () => {
	it('disjoint primitives + required', () => {
		expectEquivalent(
			() => [t.Object({ id: t.Number() }), t.Object({ tok: t.String() })],
			[
				{ id: 5, tok: 'x' },
				{ id: 5 },
				{ tok: 'x' },
				{},
				{ id: 'no', tok: 1 }
			]
		)
	})

	it('codec property (t.Date) survives by reference', () => {
		expectEquivalent(
			() => [t.Object({ when: t.Date() }), t.Object({ n: t.Number() })],
			[
				{ when: '2020-01-01T00:00:00.000Z', n: 1 },
				{ when: 'not-a-date', n: 1 },
				{ n: 1 }
			]
		)
	})

	it('nested object + format/pattern + 3 members', () => {
		expectEquivalent(
			() => [
				t.Object({ a: t.Object({ b: t.Number() }) }),
				t.Object({ email: t.String({ format: 'email' }) }),
				t.Object({ flag: t.Boolean() })
			],
			[
				{ a: { b: 1 }, email: 'a@b.co', flag: true },
				{ a: { b: 'no' }, email: 'a@b.co', flag: true },
				{ a: { b: 1 }, email: 'nope', flag: true }
			]
		)
	})
})

describe('shallowMergeObjects bails (→ Evaluate fallback)', () => {
	it('overlapping keys → null (Evaluate intersects them)', () => {
		expect(
			shallowMergeObjects([
				t.Object({ id: t.Number() }),
				t.Object({ id: t.String() })
			])
		).toBeNull()
	})

	it('non-object member → null', () => {
		expect(
			shallowMergeObjects([
				t.Object({ a: t.Number() }),
				t.String() as any
			])
		).toBeNull()
	})

	it('additionalProperties → null', () => {
		expect(
			shallowMergeObjects([
				t.Object({ a: t.Number() }, { additionalProperties: false }),
				t.Object({ b: t.String() })
			])
		).toBeNull()
	})

	it('object-level constraint (minProperties) → null', () => {
		expect(
			shallowMergeObjects([
				t.Object({ a: t.Number() }, { minProperties: 1 }),
				t.Object({ b: t.String() })
			])
		).toBeNull()
	})

	it('prototype-wrapped optional property → null (Evaluate drops inherited type)', () => {
		// t.Optional(t.String()) is Object.create(string); reusing it would be
		// MORE strict than Evaluate's lossy clone — so we bail to stay identical.
		expect(
			shallowMergeObjects([
				t.Object({ id: t.Number() }),
				t.Object({ maybe: t.Optional(t.String()) })
			])
		).toBeNull()
	})

	it('DEEPLY-nested optional (inside a nested object) → null', () => {
		// the divergence can hide at any depth — the detector is recursive
		expect(
			shallowMergeObjects([
				t.Object({
					outer: t.Object({ inner: t.Optional(t.Number()) })
				}),
				t.Object({ b: t.String() })
			])
		).toBeNull()
	})

	it('accessor (getter) constraint → null (Evaluate drops accessors)', () => {
		// t.Number({ get minimum() {…} }) keeps `minimum` as a live getter;
		// Evaluate's data-clone drops it, so reusing it would be MORE strict → bail
		expect(
			shallowMergeObjects([
				t.Object({
					a: t.Number({
						get minimum() {
							return 1000
						}
					})
				}),
				t.Object({ b: t.String() })
			])
		).toBeNull()
	})

	it('optional WITH an options bag still fires (own keys survive Evaluate)', () => {
		// t.Optional(t.Number({ default: 1 })) has own keys → Evaluate preserves
		// them → no divergence → fast path is safe
		expectEquivalent(
			() => [
				t.Object({ a: t.Optional(t.Number({ default: 1 })) }),
				t.Object({ b: t.String() })
			],
			[{ b: 'x' }, { a: 5, b: 'x' }, { a: 'no', b: 'x' }]
		)
	})
})
