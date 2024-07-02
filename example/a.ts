import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true }).get(
	'/',
	({ query: { ids } }) => ids,
	{
		query: t.Object({
			ids: t.Union([
				t.Array(t.Union([t.Object({ a: t.String() }), t.Numeric()])),
				t.Numeric()
			])
		})
	}
)

app.handle(req(`/?ids=1&ids=${JSON.stringify({ a: 'b' })}`))
	.then((res) => res.text())
	.then(console.log)

console.log(app.routes[0].composed?.toString())
