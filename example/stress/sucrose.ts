// @ts-nocheck

import { sucrose } from '../../src/2/sucrose'
import { profile } from './utils'

const total = 100_000
const stop = profile('100k sucrose instances')

for (let i = 0; i < total; i++) {
	sucrose({
		handler: function ({ query }) {
			query.a
		},
		afterHandle: [],
		beforeHandle: [
			function a({ params: { a, c: d }, ...rest }) {
				query.b
			},
			({ error }) => {}
		],
		error: [
			function a({ query, query: { a, c: d }, headers: { hello } }) {
				query.b
			},
			({ query: { f } }) => {}
		],
		mapResponse: undefined,
		onResponse: undefined,
		parse: undefined,
		request: undefined,
		start: undefined,
		stop: undefined,
		trace: undefined,
		transform: undefined
	})
}

stop()
