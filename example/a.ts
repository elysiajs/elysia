import { Elysia, error, t } from '../src'
import { sucrose } from '../src/sucrose'
import { post, req } from '../test/utils'

console.log(
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
)
