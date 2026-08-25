import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'
import { TypeBoxValidator } from '../../src/type/bridge'
import { parseCount } from '../utils'

describe('TypeSystem - ObjectString', () => {
	it('creates an empty object unless a default is provided', () => {
		expect(Value.Create(t.ObjectString({}))).toEqual({})
		expect(
			Value.Create(
				t.ObjectString(
					{},
					{
						default: '{}'
					}
				)
			)
		).toBe('{}')
	})

	it('accepts objects matching the property schema', () => {
		const schema = t.ObjectString({
			pageIndex: t.Number(),
			pageLimit: t.Number()
		})

		expect(Value.Check(schema, { pageIndex: 1, pageLimit: 1 })).toBe(true)
	})

	it('preserves objects during encoding', () => {
		const schema = t.ObjectString({
			pageIndex: t.Number(),
			pageLimit: t.Number()
		})

		expect(
			Value.Encode(schema, {
				pageIndex: 1,
				pageLimit: 1
			})
		).toEqual({
			pageIndex: 1,
			pageLimit: 1
		})
	})

	it('decodes valid JSON objects and rejects missing properties', () => {
		const schema = t.ObjectString({
			pageIndex: t.Number(),
			pageLimit: t.Number()
		})

		expect(
			Value.Decode<typeof schema>(
				schema,
				JSON.stringify({
					pageIndex: 1,
					pageLimit: 1
				})
			)
		).toEqual({ pageIndex: 1, pageLimit: 1 })

		expect(() =>
			Value.Decode<typeof schema>(
				schema,
				JSON.stringify({
					pageLimit: 1
				})
			)
		).toThrow()
	})

	it('decodes JSON objects in query parameters', async () => {
		const app = new Elysia().get(
			'/',
			{
				query: t.Object({
					pagination: t.ObjectString({
						pageIndex: t.Number(),
						pageLimit: t.Number()
					})
				})
			},
			({ query }) => query
		)

		const res1 = await app.handle(
			'/?pagination={"pageIndex":1,"pageLimit":1}'
		)
		expect(res1.status).toBe(200)

		const res2 = await app.handle('/?pagination={"pageLimit":1}')
		expect(res2.status).toBe(422)
	})

	it('supports optional object-string properties', async () => {
		const schema = t.Object({
			name: t.String(),
			metadata: t.Optional(
				t.ObjectString({
					pageIndex: t.Number(),
					pageLimit: t.Number()
				})
			)
		})

		expect(Value.Check(schema, { name: 'test' })).toBe(true)
		expect(Value.Create(schema).metadata).toBeUndefined()

		expect(
			Value.Check(schema, {
				name: 'test',
				metadata: { pageIndex: 1, pageLimit: 10 }
			})
		).toBe(true)
		expect(Value.Check(schema, { name: 'test', metadata: {} })).toBe(false)
	})

	it('uses and validates an object default', async () => {
		const schema = t.ObjectString(
			{
				pageIndex: t.Number(),
				pageLimit: t.Number()
			},
			{
				default: { pageIndex: 0, pageLimit: 10 }
			}
		)

		expect(Value.Create(schema)).toEqual({ pageIndex: 0, pageLimit: 10 })

		expect(Value.Check(schema, { pageIndex: 1, pageLimit: 20 })).toBe(true)
		expect(Value.Check(schema, { pageIndex: 0, pageLimit: 10 })).toBe(true)
		expect(
			Value.Check(schema, JSON.stringify({ pageIndex: 1, pageLimit: 20 }))
		).toBe(true)
		expect(
			Value.Check(schema, JSON.stringify({ pageIndex: 0, pageLimit: 10 }))
		).toBe(true)

		expect(Value.Check(schema, {})).toBe(false)
		expect(Value.Check(schema, { pageIndex: 1 })).toBe(false)
		expect(Value.Check(schema, undefined)).toBe(false)
	})
})

/**
 * Validating a still-encoded value used to parse it three times: the refine is
 * invoked more than once per validation, and decode parsed again on its own.
 * The schema now carries a one-slot parse memo, so a fresh schema instance per
 * test is what keeps these counts deterministic.
 */
describe('TypeSystem - ObjectString raw string lane', () => {
	const validator = () =>
		new (TypeBoxValidator as any)(
			t.Object({
				meta: t.ObjectString({ nonce: t.String(), issued: t.Number() })
			})
		)

	const encoded = '{"nonce":"a","issued":1}'
	const decoded = { meta: { nonce: 'a', issued: 1 } }

	it('parses a raw string once across check and decode', () => {
		expect(parseCount(validator(), { meta: encoded })).toBe(1)
	})

	it('decodes that raw string to the same value as before', () => {
		expect(validator().From({ meta: encoded })).toEqual(decoded)
	})

	it('never parses a string failing the opening-brace gate', () => {
		// the gate short-circuits ahead of JSON.parse, so junk input never
		// reaches the inner check and never triggers its lazy compile either
		expect(parseCount(validator(), { meta: 'plain' })).toBe(0)
		expect(() => validator().From({ meta: 'plain' })).toThrow()
	})

	it('parses a malformed string once and still rejects it', () => {
		expect(parseCount(validator(), { meta: '{not json' })).toBe(1)
		expect(() => validator().From({ meta: '{not json' })).toThrow()
	})

	it('rejects a raw string whose decoded field is wrong', () => {
		expect(() =>
			validator().From({ meta: '{"nonce":"a","issued":"x"}' })
		).toThrow()
	})

	it('passes a pre-decoded object through without parsing', () => {
		const v = validator()

		expect(parseCount(v, decoded)).toBe(0)
		expect(v.From(structuredClone(decoded))).toEqual(decoded)
	})

	it('does not serve one value out of another value memo', () => {
		// A failing sibling rejects the request only after `meta` passed, so
		// the memo is still populated when the next payload arrives. Asserted
		// at Check, not From: decode re-validates what it decodes, which would
		// mask a memo keyed on presence rather than on the exact string.
		const schema = t.Object({
			meta: t.ObjectString({ nonce: t.String(), issued: t.Number() }),
			token: t.Number()
		})

		expect(Value.Check(schema, { meta: encoded, token: 'bad' })).toBe(false)
		expect(
			Value.Check(schema, { meta: '{"nonce":"c"}', token: 1 })
		).toBe(false)
	})

	it('releases the memo once decode consumes it', () => {
		const v = validator()

		// a memo that outlived its decode would let the second run skip the
		// parse entirely and hand back the first run's object
		expect(parseCount(v, { meta: encoded })).toBe(1)
		expect(parseCount(v, { meta: encoded })).toBe(1)
	})

	it('skips the memo for a payload past the size cap', () => {
		// pinning a large payload until the next successful decode is worse
		// than re-parsing it, so past the cap the memo is simply not taken and
		// the parse count falls back to what it was before the memo existed
		const v = validator()
		const big = JSON.stringify({
			nonce: 'n'.repeat(9000),
			issued: 1
		})

		expect(big.length).toBeGreaterThan(8192)
		expect(parseCount(v, { meta: big })).toBe(3)
	})
})

/**
 * An ObjectString arriving still encoded used to lose every optional or
 * coercing property of its decoded shape: exact-mirror's optional-cleanup
 * epilogue decided whether to delete a key by reading that key's path on the
 * *input*, and behind a codec that swaps the container's type (string ->
 * object) that path is unreachable, so it read `undefined` and deleted the
 * decoded value. Silent field loss on a 200.
 *
 * SKIPPED until exact-mirror ships the fix (elysiajs/exact-mirror, branch
 * `fix/codec-container-optional-drop`). Un-skip together with the dependency
 * bump in package.json — verified green against that build locally.
 *
 * `t.ArrayString` was never affected, since array elements are addressed
 * positionally and never reach the epilogue; it stays enabled below as the
 * control that the surrounding decode path works.
 */
describe('TypeSystem - ObjectString inner coercion', () => {
	const shape = t.Object({
		m: t.ObjectString({ n: t.Numeric(), s: t.String() })
	})

	const body = (value: unknown) =>
		new Request('http://localhost/b', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(value)
		})

	const app = () => new Elysia().post('/b', { body: shape }, ({ body }) => body)

	it.skip('coerces an inner field of a still-encoded object', async () => {
		const res = await app().handle(body({ m: '{"n":"42","s":"keep"}' }))

		expect(res.status).toBe(200)
		const out = (await res.json()) as any
		expect(out).toEqual({ m: { n: 42, s: 'keep' } })
		expect(typeof out.m.n).toBe('number')
	})

	it.skip('keeps an optional inner field of a still-encoded object', async () => {
		const optional = new Elysia().post(
			'/b',
			{ body: t.Object({ m: t.ObjectString({ s: t.Optional(t.String()) }) }) },
			({ body }) => body
		)

		const res = await optional.handle(body({ m: '{"s":"keep"}' }))

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ m: { s: 'keep' } })
	})

	it('coerces an inner field of a pre-decoded object', async () => {
		// this lane always worked: the input path the epilogue reads is real
		const res = await app().handle(body({ m: { n: '42', s: 'keep' } }))

		expect(res.status).toBe(200)
		const out = (await res.json()) as any
		expect(out).toEqual({ m: { n: 42, s: 'keep' } })
		expect(typeof out.m.n).toBe('number')
	})

	it('rejects an invalid inner coercing value rather than dropping it', async () => {
		// the important half of the contract even before the fix: a bad value
		// must 422, never vanish into a 200
		const res = await app().handle(body({ m: '{"n":"abc","s":"keep"}' }))

		expect(res.status).toBe(422)
	})

	it('coerces array-string elements (control, never affected)', async () => {
		const control = new Elysia().post(
			'/b',
			{ body: t.Object({ a: t.ArrayString(t.Numeric()) }) },
			({ body }) => body
		)

		const res = await control.handle(body({ a: '["1","2"]' }))

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ a: [1, 2] })
	})
})
