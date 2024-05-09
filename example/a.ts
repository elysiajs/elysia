// ? server
import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true })
	.model({
		user: t.Object({
			name: t.String(),
			age: t.Number()
		})
	})
	.get('/', ({ query: { name } }) => name)
	.post('/', ({ body: { name } }) => name, {
		body: 'user'
	})
	.compile()

export const { models } = app

await app.handle(req('/?name=elysia')).then(x => x.text()).then(console.log)

// console.log(app.routes[0].composed.toString())
