import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

import { separateFunction } from '../../src/sucrose'

describe('Sucrose: Main', () => {
	it('inherits inference from plugin', () => {
		const plugin = new Elysia()
			.derive(({ headers: { authorization } }) => {
				return {
					get auth() {
						return authorization
					}
				}
			})

		const main = new Elysia()
			.use(plugin)

		expect(main.inference.event.headers).toBe(true)
	})
})
