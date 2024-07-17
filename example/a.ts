import { Elysia, t } from '../src'
import { retrieveRootParamters, sucrose } from '../src/sucrose'

// const parameter = '({ hello: { a }, path })'
// const result = retrieveRootParamters(parameter)

// console.log(result)

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
