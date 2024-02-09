import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

import { separateFunction, sucrose } from '../../src/sucrose'

describe('sucrose integration', () => {
	it('inherits inference from plugin', () => {
		const plugin = new Elysia().derive(({ headers: { authorization } }) => {
			return {
				get auth() {
					return authorization
				}
			}
		})

		const main = new Elysia().use(plugin)

		expect(main.inference.event.headers).toBe(true)
	})

	it('common 1', () => {
		const a = sucrose({
			handler: function ({ query }) {
				query.a
			},
			afterHandle: [],
			beforeHandle: [],
			error: [
				function a({
					query,
					query: { a, c: d },
					headers: { hello },
					...rest
				}) {
					query.b
					rest.query.e
				},
				({ query: { f } }) => {}
			],
			mapResponse: [],
			onResponse: [],
			parse: [],
			request: [],
			start: [],
			stop: [],
			trace: [],
			transform: []
		})

		console.log(a)
	})
})
