// @ts-nocheck

import { sucrose } from '../../src/sucrose'

const total = 100_000
const t = performance.now()

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
		mapResponse: [],
		onResponse: [],
		parse: [],
		request: [],
		start: [],
		stop: [],
		trace: [],
		transform: []
	})
}

const took = performance.now() - t

console.log(
	Intl.NumberFormat().format(total),
	'check took',
	+took.toFixed(4),
	'ms'
)
console.log('Average', +(took / total).toFixed(4), 'ms / check')
