import { Elysia, t } from '../src'
import { sucrose } from '../src/sucrose'
import { req } from '../test/utils'

console.log(
	sucrose({
		handler: ({ set, cookie: { auth } }) => {
			console.log(auth.value)
			return ''
		},
		afterHandle: [],
		beforeHandle: [],
		error: [],
		mapResponse: [],
		afterResponse: [],
		parse: [],
		request: [],
		start: [],
		stop: [],
		trace: [],
		transform: []
	})
)
