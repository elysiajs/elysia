import { Elysia, t, replaceSchemaType } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get('/', ({ query: { keys } }) => {
	console.log(keys)

	return keys
})

console.log(app.routes[0]?.composed?.toString())

const response = app
	.handle(
		new Request(
			`http://localhost/?keys=${JSON.stringify({ hello: 'world' })}`
		)
	)
	.then((res) => res.text())

// console.log(app.routes[0].composed?.toString())
