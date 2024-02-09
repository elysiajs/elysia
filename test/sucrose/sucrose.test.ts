import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

import { separateFunction, sucrose } from '../../src/sucrose'

describe('sucrose', () => {
	it('common 1', () => {
		expect(
			sucrose({
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
		).toEqual({
			queries: ['a', 'e', 'b', 'c', 'f'],
			query: true,
			headers: true,
			body: false,
			cookie: false,
			set: false
		})
	})
})
