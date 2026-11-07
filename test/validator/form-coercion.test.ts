import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'

// A t.Form body is multipart: every field arrives as a string, like a query.
// It used to get the JSON body coercion, so `n=9` failed t.Number() and
// `nums=1&nums=2` failed t.Array(t.Number()) unless the schema also had a file

const form = (entries: [string, string][]) => {
	const data = new FormData()
	for (const [key, value] of entries) data.append(key, value)

	return { method: 'POST', body: data }
}

describe('t.Form coercion', () => {
	const app = new Elysia().post(
		'/',
		{
			body: t.Form({
				n: t.Number(),
				b: t.Boolean(),
				e: t.UnionEnum([1, 2]),
				m: t.MaybeEmpty(t.Number()),
				nums: t.Array(t.Number())
			})
		},
		({ body }) => body
	)

	it('coerces fields like a query', async () => {
		const response = await app.handle(
			new Request(
				'http://localhost/',
				form([
					['n', '9'],
					['b', 'true'],
					['e', '2'],
					['m', ''],
					['nums', '1'],
					['nums', '2']
				])
			)
		)

		expect(await response.json()).toEqual({
			n: 9,
			b: true,
			e: 2,
			nums: [1, 2]
		})
	})

	it('still rejects an invalid field', async () => {
		const response = await app.handle(
			new Request(
				'http://localhost/',
				form([
					['n', 'x'],
					['b', 'true'],
					['e', '2'],
					['nums', '1'],
					['nums', '2']
				])
			)
		)

		expect(response.status).toBe(422)
	})
})
