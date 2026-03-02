import { Elysia } from '../src'
import { mapEarlyResponse } from '../src/adapter/web-standard/handler'

const body = {
	name: 'Shiroko'
}

const context = {
	headers: {
		'x-powered-by': 'Elysia',
		'coffee-scheme': 'Coffee'
	},
	status: 418,
	cookie: {}
}

const response = await mapEarlyResponse(
	new Promise((resolve) => resolve(body)),
	context
)

console.log(response?.headers)
