import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'
import { req, parseCount } from '../utils'
import { TypeBoxValidator } from '../../src/type/bridge'

describe('TypeSystem - ArrayString', () => {
	it('creates an empty array unless a default is provided', () => {
		// @ts-expect-error t.ArrayString requires an items schema
		expect(Value.Create(t.ArrayString())).toEqual([])

		expect(
			Value.Create(
				t.ArrayString(t.Any(), {
					default: '[]'
				})
			)
		).toBe('[]')
	})

	it('accepts decoded arrays', () => {
		const schema = t.ArrayString(t.Number())

		expect(Value.Check(schema, [1])).toBe(true)
	})

	it('preserves arrays during encoding', () => {
		const schema = t.ArrayString(t.Number())

		expect(Value.Encode(schema, [1])).toEqual([1])
	})

	it('decodes JSON arrays and rejects non-array strings', () => {
		const schema = t.ArrayString(t.Number())

		expect(Value.Decode<typeof schema>(schema, '[1]')).toEqual([1])

		expect(Value.Check(schema, '1')).toBe(false)
	})

	it('decodes arrays in request bodies', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					id: t.ArrayString(t.Number())
				})
			},
			({ body }) => body
		)

		const res1 = await app.handle(
			new Request('http://localhost', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: JSON.stringify([1, 2, 3]) })
			})
		)
		expect(res1.status).toBe(200)

		const res2 = await app.handle(
			new Request('http://localhost', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: [1, 2, 3] })
			})
		)
		expect(res2.status).toBe(200)

		const res3 = await app.handle(
			new Request('http://localhost', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: ['a', 2, 3] })
			})
		)
		expect(res3.status).toBe(422)
	})
})

/**
 * Validating a still-encoded value used to parse it three times: the refine is
 * invoked more than once per validation, and decode parsed again on its own.
 * The schema now carries a one-slot parse memo, so a fresh schema instance per
 * test is what keeps these counts deterministic.
 */
describe('TypeSystem - ArrayString raw string lane', () => {
	const validator = () =>
		new (TypeBoxValidator as any)(
			t.Object({ ids: t.ArrayString(t.Number()) })
		)

	it('parses a raw string once across check and decode', () => {
		expect(parseCount(validator(), { ids: '[1,2,3]' })).toBe(1)
	})

	it('decodes that raw string to the same value as before', () => {
		expect(validator().From({ ids: '[1,2,3]' })).toEqual({ ids: [1, 2, 3] })
	})

	it('never parses a string failing the opening-bracket gate', () => {
		// the gate short-circuits ahead of JSON.parse, so junk input never
		// reaches the inner check and never triggers its lazy compile either
		expect(parseCount(validator(), { ids: 'plain' })).toBe(0)
		expect(() => validator().From({ ids: 'plain' })).toThrow()
	})

	it('parses a malformed string once and still rejects it', () => {
		expect(parseCount(validator(), { ids: '[not json' })).toBe(1)
		expect(() => validator().From({ ids: '[not json' })).toThrow()
	})

	it('rejects a raw string whose decoded element is wrong', () => {
		expect(() => validator().From({ ids: '[1,"x"]' })).toThrow()
	})

	it('applies an inner codec to the memoized parse', () => {
		// the object the refine parsed is what decode now receives, so an inner
		// coercing type still has to run against it. ObjectString is not
		// covered here: it currently drops inner coercing fields outright,
		// which is pre-existing and reported separately.
		const v = new (TypeBoxValidator as any)(
			t.Object({ ids: t.ArrayString(t.Numeric()) })
		)

		expect(v.From({ ids: '["1","2"]' })).toEqual({ ids: [1, 2] })
	})

	it('passes a pre-decoded array through without parsing', () => {
		const v = validator()

		expect(parseCount(v, { ids: [1, 2] })).toBe(0)
		expect(v.From({ ids: [1, 2] })).toEqual({ ids: [1, 2] })
	})

	it('does not serve one value out of another value memo', () => {
		// A failing sibling rejects the request only after `ids` passed, so the
		// memo is still populated when the next payload arrives. Asserted at
		// Check, not From: decode re-validates what it decodes, which would
		// mask a memo keyed on presence rather than on the exact string.
		const schema = t.Object({
			ids: t.ArrayString(t.Number()),
			token: t.Number()
		})

		expect(Value.Check(schema, { ids: '[1,2]', token: 'bad' })).toBe(false)
		expect(Value.Check(schema, { ids: '[3,"x"]', token: 1 })).toBe(false)
	})

	it('releases the memo once decode consumes it', () => {
		const v = validator()

		// a memo that outlived its decode would let the second run skip the
		// parse entirely and hand back the first run's object
		expect(parseCount(v, { ids: '[1,2,3]' })).toBe(1)
		expect(parseCount(v, { ids: '[1,2,3]' })).toBe(1)
	})

	it('hands back a fresh object for each validation of one string', () => {
		const v = validator()

		const first = v.From({ ids: '[1,2,3]' })
		const second = v.From({ ids: '[1,2,3]' })

		expect(first).toEqual(second)
		expect(first.ids).not.toBe(second.ids)
	})

	it('skips the memo for a payload past the size cap', () => {
		// pinning a large payload until the next successful decode is worse
		// than re-parsing it, so past the cap the memo is simply not taken and
		// the parse count falls back to what it was before the memo existed
		const v = validator()
		const big = JSON.stringify(Array.from({ length: 4000 }, (_, i) => i))

		expect(big.length).toBeGreaterThan(8192)
		expect(parseCount(v, { ids: big })).toBe(3)
	})
})
