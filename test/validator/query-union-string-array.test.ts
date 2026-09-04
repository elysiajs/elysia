import { Elysia, t } from '../../src'
import { describe, expect, it } from 'bun:test'

describe('query union string|string[] (#1028)', () => {
	const server = new Elysia().get('/query', ({ query: { tags } }) => ({ tags }), {
		query: t.Partial(
			t.Object({
				tags: t.Union([t.Array(t.String()), t.String()])
			})
		)
	})

	it('array of values stays an array', async () => {
		const res = await server.handle(new Request('http://localhost/query?tags=a&tags=b&tags=c'))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ tags: ['a', 'b', 'c'] })
	})

	it('single value stays a string', async () => {
		const res = await server.handle(new Request('http://localhost/query?tags=a'))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ tags: 'a' })
	})

	it('string-first union (t.String() before t.Array) behaves identically', async () => {
		const server2 = new Elysia().get(
			'/query',
			({ query: { tags } }) => ({ tags }),
			{
				query: t.Partial(
					t.Object({
						tags: t.Union([t.String(), t.Array(t.String())])
					})
				)
			}
		)

		const multi = await server2.handle(new Request('http://localhost/query?tags=a&tags=b&tags=c'))
		expect(await multi.json()).toEqual({ tags: ['a', 'b', 'c'] })

		const single = await server2.handle(new Request('http://localhost/query?tags=a'))
		expect(await single.json()).toEqual({ tags: 'a' })
	})
})
