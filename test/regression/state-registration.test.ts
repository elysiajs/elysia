import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { req } from '../utils'

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
			app.handle(req('/')).then((response) => response.json())
		).resolves.toEqual({
			list: [],
			obj: {},
			hasList: true,
			hasObj: true
		})
	})
})
