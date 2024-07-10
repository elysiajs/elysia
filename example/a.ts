import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get('/', ({ query }) => query, {
	query: t.Optional(
		t.Object({
			id: t.Numeric()
		})
	)
})

await app.handle(req('/'))
	.then(x => x.json())
	.then(console.log)
