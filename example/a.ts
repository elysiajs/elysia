import { Elysia, sse, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get('/', ({ query }) => query, {
	query: t.Object(
		{
			name: t.String()
		},
		{ additionalProperties: true }
	)
})

const response = await app
	.handle(req('/?name=nagisa&hifumi=daisuki'))
	.then((x) => x.json())

console.log(response)

console.log(app.routes[0].hooks)
