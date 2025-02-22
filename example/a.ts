import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true }).get('/', ({ query }) => query, {
	query: t.Object({
		status: t.Optional(t.Union([t.String(), t.Array(t.String())]))
	})
})

app.handle(req('/?status=a&'))
	.then((x) => x.json())
	.then(console.log)
