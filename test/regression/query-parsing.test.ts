import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'

describe('array query parameters', () => {
	const app = new Elysia().get(
		'/x',
		{ query: t.Object({ ids: t.Array(t.String()) }) },
		({ query }) => query.ids
	)
	const run = (query: string) =>
		app.handle(`/x?${query}`).then((response) => response.json())

	it('keeps an encoded comma inside one array element', async () => {
		await expect(run('ids=a%2Cb')).resolves.toEqual(['a,b'])
		await expect(run('ids=[a%2Cb]')).resolves.toEqual(['a,b'])
	})

	it('splits raw commas and separators from a fully encoded array literal', async () => {
		await expect(run('ids=a,b')).resolves.toEqual(['a', 'b'])
		await expect(run('ids=[a,b]')).resolves.toEqual(['a', 'b'])
		await expect(
			run('ids=' + encodeURIComponent('[a,b]'))
		).resolves.toEqual(['a', 'b'])
	})

	it('treats an empty array literal as an empty array', async () => {
		await expect(run('ids=[]')).resolves.toEqual([])
	})
})
