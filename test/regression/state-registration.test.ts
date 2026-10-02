import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

describe('state registration', () => {
	it('preserves named empty arrays and objects at runtime', async () => {
		const app = new Elysia()
			.state('list', [] as string[])
			.state('obj', {} as Record<string, string>)
			.get('/', ({ store }) => ({
				list: store.list,
				obj: store.obj,
				hasList: store.list !== undefined,
				hasObj: store.obj !== undefined
			}))

		await expect(
			app.handle('/').then((response) => response.json())
		).resolves.toEqual({
			list: [],
			obj: {},
			hasList: true,
			hasObj: true
		})
	})
})
