import { describe, expect, it } from 'bun:test'
import { HasCodec } from 'typebox/value'

import { Elysia, t } from '../../src'

// t.Object / t.Array must keep `~kind` as an own property: TypeBox clones
// (t.Cyclic, t.Codec, t.Refine, t.Unsafe) copy own descriptors only. A
// prototype `~kind` vanished on clone, so the clone was no longer a schema:
// t.Cyclic lost every codec and coercion (the handler got strings where the
// type promises numbers and Dates), and t.Codec(t.Object(...)) as a route root
// was rejected as "not a schema"

const Len = t
	.Codec(t.String())
	.Decode((value) => value.length)
	.Encode((value) => 'x'.repeat(value))

const json = (body: unknown) => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body)
})

const describeValue = (value: unknown) =>
	value instanceof Date
		? `Date:${value.toISOString()}`
		: `${typeof value}:${String(value)}`

describe('t.Object / t.Array own ~kind', () => {
	it('survives TypeBox clones', () => {
		const object = t.Object({ a: t.String() })
		const array = t.Array(t.String())

		expect(Object.hasOwn(object, '~kind')).toBe(true)
		expect(Object.hasOwn(array, '~kind')).toBe(true)
		// still hidden from JSON Schema output
		expect(Object.keys(object)).not.toContain('~kind')

		const cyclic: any = t.Cyclic({ N: t.Object({ l: Len }) }, 'N')
		expect(cyclic.$defs.N['~kind']).toBe('Object')
		expect(HasCodec(cyclic)).toBe(true)

		expect((t.Unsafe(object) as any)['~kind']).toBe('Object')
		expect(
			(
				t
					.Codec(array)
					.Decode((v) => v)
					.Encode((v) => v) as any
			)['~kind']
		).toBe('Array')
	})
})

describe('t.Cyclic decode', () => {
	const node = (leaf: any) =>
		t.Cyclic(
			{ Node: t.Object({ v: leaf, next: t.Optional(t.Ref('Node')) }) },
			'Node'
		)

	for (const [name, leaf, input, expected] of [
		['t.Numeric', t.Numeric(), '1', 'number:1'],
		['t.BooleanString', t.BooleanString(), 'true', 'boolean:true'],
		['t.Date', t.Date(), '2024-01-01', 'Date:2024-01-01T00:00:00.000Z'],
		['a custom codec', Len, 'abc', 'number:3']
	] as const)
		it(`decodes ${name} at every depth`, async () => {
			const app = new Elysia().post(
				'/',
				{ body: node(leaf) },
				({ body }) => [
					describeValue(body.v),
					describeValue(body.next?.v)
				]
			)

			const response = await app.handle(
				new Request(
					'http://localhost/',
					json({ v: input, next: { v: input } })
				)
			)
			expect(await response.json()).toEqual([expected, expected])
		})

	it('coerces a cyclic query root like a plain object root', async () => {
		const app = new Elysia().get(
			'/',
			{ query: t.Cyclic({ Q: t.Object({ n: t.Number() }) }, 'Q') },
			({ query }) => describeValue(query.n)
		)

		const response = await app.handle(new Request('http://localhost/?n=1'))
		expect(response.status).toBe(200)
		expect(await response.text()).toBe('number:1')
	})
})

describe('t.Codec(t.Object) as a route root', () => {
	// was rejected as "not a schema"; the codec decodes to the encoded shape
	// since the decode mirror still cleans an object codec's output against it
	it('is a schema and decodes', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t
					.Codec(t.Object({ a: t.String() }))
					.Decode((value) => ({ a: value.a.toUpperCase() }))
					.Encode((value) => ({ a: value.a.toLowerCase() }))
			},
			({ body }) => body
		)

		const response = await app.handle(
			new Request('http://localhost/', json({ a: 'x' }))
		)
		expect(await response.json()).toEqual({ a: 'X' })
	})
})

// TypeBox Clean shapes the decoded value by the encoded schema. Before own
// `~kind` it skipped a codec object (no kind), so its output survived; it must
// still, or normalize: 'typebox' cleans a Map down to `{}`
describe("normalize: 'typebox' and a codec object", () => {
	it('keeps the decoded value and still removes unknown fields', async () => {
		const app = new Elysia({ normalize: 'typebox' }).post(
			'/',
			{
				body: t.Object({
					m: t
						.Codec(t.Object({ a: t.String() }))
						.Decode((value) => ({ upper: value.a.toUpperCase() }))
						.Encode((value) => ({ a: value.upper }))
				})
			},
			({ body }) => body
		)

		const response = await app.handle(
			new Request(
				'http://localhost/',
				json({ m: { a: 'x' }, unknown: 1 })
			)
		)
		expect(await response.json()).toEqual({ m: { upper: 'X' } })
	})
})

// Own `~kind` lets query/form coercion reach a refined or codec node. A
// coercion must never be looser than the schema: a refinement comes along
// (Object/Array: on the inner node both JSON branches check; a primitive: on
// the decoded value), a codec keeps the node, whose string input then fails
describe('query coercion of a refined or codec node', () => {
	const above5 = (value: number) => value > 5
	const app = new Elysia()
		.get(
			'/refined',
			{
				query: t.Object({
					o: t.Refine(
						t.Object({ a: t.Number() }),
						(value) => above5(value.a),
						() => 'must be above 5'
					)
				})
			},
			({ query }) => query.o
		)
		.get(
			'/list',
			{
				query: t.Object({
					o: t.Refine(
						t.Array(t.Number()),
						(value) => value.length > 1,
						() => 'needs two'
					)
				})
			},
			({ query }) => query.o
		)
		.get(
			'/codec',
			{
				query: t.Object({
					o: t
						.Codec(t.Object({ a: t.String() }))
						.Decode((value) => ({ upper: value.a.toUpperCase() }))
						.Encode((value) => ({ a: value.upper }))
				})
			},
			({ query }) => query.o
		)
		.get(
			'/number',
			{ query: t.Object({ n: t.Refine(t.Number(), above5) }) },
			({ query }) => query.n
		)
		.get(
			'/cyclic',
			{
				query: t.Cyclic(
					{ Q: t.Object({ n: t.Refine(t.Number(), above5) }) },
					'Q'
				)
			},
			({ query }) => query.n
		)

	const get = (path: string) =>
		app.handle(new Request('http://localhost' + path))
	const encoded = (value: unknown) =>
		encodeURIComponent(JSON.stringify(value))

	it('enforces the refinement on the parsed object/array', async () => {
		expect((await get(`/refined?o=${encoded({ a: 1 })}`)).status).toBe(422)

		const passed = await get(`/refined?o=${encoded({ a: 9, extra: 1 })}`)
		expect(passed.status).toBe(200)
		expect(await passed.json()).toEqual({ a: 9 })

		expect((await get('/list?o=1')).status).toBe(422)
		expect(await (await get('/list?o=1&o=2')).json()).toEqual([1, 2])
	})

	// as before own `~kind`: an undecoded or reshaped value never reaches the handler
	it('rejects a codec object instead of skipping its decode', async () => {
		expect((await get(`/codec?o=${encoded({ a: 'q' })}`)).status).toBe(422)
	})

	// the refine checks the decoded number: dropping it accepted anything,
	// running it on the raw string would reject everything
	it('runs a refinement on a coerced number', async () => {
		for (const path of ['/number', '/cyclic']) {
			expect((await get(`${path}?n=1`)).status).toBe(422)
			expect(await (await get(`${path}?n=9`)).text()).toBe('9')
		}
	})
})
