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

describe('shallowMergeObjects matches evaluated intersections', () => {
	it('merges disjoint required primitive properties', () => {
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

	it('preserves a codec property', () => {
		expectEquivalent(
			() => [t.Object({ when: t.Date() }), t.Object({ n: t.Number() })],
			[
				{ when: '2020-01-01T00:00:00.000Z', n: 1 },
				{ when: 'not-a-date', n: 1 },
				{ n: 1 }
			]
		)
	})

	it('merges nested and formatted properties across three members', () => {
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

	it('merges an optional property without falling back to Evaluate', () => {
		expectEquivalent(
			() => [
				t.Object({ id: t.Number() }),
				t.Object({ maybe: t.Optional(t.String()) })
			],
			[
				{ id: 1 },
				{ id: 1, maybe: 'x' },
				{ id: 1, maybe: 5 },
				{ maybe: 'x' }
			]
		)
	})

	it('merges a nested optional property', () => {
		expectEquivalent(
			() => [
				t.Object({
					outer: t.Object({ inner: t.Optional(t.Number()) })
				}),
				t.Object({ b: t.String() })
			],
			[
				{ outer: {}, b: 'x' },
				{ outer: { inner: 1 }, b: 'x' },
				{ outer: { inner: 'no' }, b: 'x' },
				{ outer: {} }
			]
		)
	})

	it('merges an optional property with an options object', () => {
		expectEquivalent(
			() => [
				t.Object({ a: t.Optional(t.Number({ default: 1 })) }),
				t.Object({ b: t.String() })
			],
			[{ b: 'x' }, { a: 5, b: 'x' }, { a: 'no', b: 'x' }]
		)
	})
})

describe('shallowMergeObjects returns null when a shallow merge is unsafe', () => {
	it('rejects overlapping keys', () => {
		expect(
			shallowMergeObjects([
				t.Object({ id: t.Number() }),
				t.Object({ id: t.String() })
			])
		).toBeNull()
	})

	it('rejects a non-object member', () => {
		expect(
			shallowMergeObjects([
				t.Object({ a: t.Number() }),
				t.String() as any
			])
		).toBeNull()
	})

	it('rejects an additionalProperties option', () => {
		expect(
			shallowMergeObjects([
				t.Object({ a: t.Number() }, { additionalProperties: false }),
				t.Object({ b: t.String() })
			])
		).toBeNull()
	})

	it('rejects an object-level constraint', () => {
		expect(
			shallowMergeObjects([
				t.Object({ a: t.Number() }, { minProperties: 1 }),
				t.Object({ b: t.String() })
			])
		).toBeNull()
	})
})

describe('getter-valued schema options', () => {
	it('preserves and enforces a getter-valued constraint', () => {
		const merged = shallowMergeObjects([
			t.Object({
				a: t.Number({
					get minimum() {
						return 1000
					}
				})
			}),
			t.Object({ b: t.String() })
		])

		expect(merged).not.toBeNull()
		expect(Check(merged as any, { a: 5, b: 'x' })).toBe(false)
		expect(Check(merged as any, { a: 5000, b: 'x' })).toBe(true)
	})
})
