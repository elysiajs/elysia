import { describe, expect, it } from 'bun:test'
import { expectTypeOf } from 'expect-type'

import { Elysia, t } from '../../src'

// t.MaybeEmpty(X) is X | null | undefined. As an object property an empty
// value is also an absent key: JSON.stringify drops `undefined`, a query
// leaves the key out. The key used to stay required, so the value the type
// allows was rejected with "must have required properties m"

const json = (body: unknown) => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body)
})

describe('t.MaybeEmpty as an object property', () => {
	const app = new Elysia()
		.post(
			'/body',
			{ body: t.Object({ m: t.MaybeEmpty(t.Number()), k: t.Number() }) },
			({ body }) => ({ body, has: 'm' in body })
		)
		.get(
			'/query',
			{ query: t.Object({ m: t.MaybeEmpty(t.Number()) }) },
			({ query }) => ({ query, has: 'm' in query })
		)

	it('is an optional key in the type', () => {
		type Body = (typeof app)['~Routes']['body']['post']['body']
		expectTypeOf<Body>().toEqualTypeOf<{
			m?: number | null | undefined
			k: number
		}>()
	})

	it('accepts an absent key', async () => {
		const response = await app.handle(
			new Request('http://localhost/body', json({ m: undefined, k: 1 }))
		)
		expect(await response.json()).toEqual({ body: { k: 1 }, has: false })

		const query = await app.handle(new Request('http://localhost/query'))
		expect(await query.json()).toEqual({ query: {}, has: false })
	})

	it('still validates a present value', async () => {
		expect(
			await (
				await app.handle(
					new Request(
						'http://localhost/body',
						json({ m: null, k: 1 })
					)
				)
			).json()
		).toEqual({ body: { m: null, k: 1 }, has: true })

		expect(
			(
				await app.handle(
					new Request('http://localhost/body', json({ m: 'x', k: 1 }))
				)
			).status
		).toBe(422)
		expect(
			await (
				await app.handle(new Request('http://localhost/query?m=3'))
			).json()
		).toEqual({ query: { m: 3 }, has: true })
	})
})

describe('t.MaybeEmpty as a root', () => {
	const app = new Elysia().post(
		'/',
		{ body: t.MaybeEmpty(t.Object({ name: t.String() })) },
		({ body }) => body ?? 'empty'
	)

	it('behaves as before: empty passes, the object stays strict', async () => {
		expect(
			await (
				await app.handle(
					new Request('http://localhost/', { method: 'POST' })
				)
			).text()
		).toBe('empty')
		expect(
			await (
				await app.handle(
					new Request('http://localhost/', json({ name: 'a' }))
				)
			).json()
		).toEqual({ name: 'a' })
		expect(
			(await app.handle(new Request('http://localhost/', json({}))))
				.status
		).toBe(422)
	})
})

// the optional marker only makes the property key optional: a root never
// skips its own check, so a refine over t.MaybeEmpty still sees null
describe('t.MaybeEmpty under a refine at the root', () => {
	it('runs the refine on an empty value', async () => {
		let calls = 0
		const app = new Elysia().post(
			'/',
			{
				body: t.Refine(
					t.MaybeEmpty(t.Number()),
					(value) => {
						calls++
						return value !== null && value !== undefined
					},
					() => 'must be present'
				)
			},
			({ body }) => body
		)

		const response = await app.handle(
			new Request('http://localhost/', json(null))
		)
		expect(response.status).toBe(422)
		expect((await response.json()).detail).toBe('must be present')
		expect(calls).toBeGreaterThan(0)

		expect(
			await (
				await app.handle(new Request('http://localhost/', json(1)))
			).text()
		).toBe('1')
	})
})
