import { Elysia, t } from '../src'
import { separateFunction } from '../src/sucrose'
import { post, req } from '../test/utils'

const app = new Elysia({ precompile: true }).get('/', ({ query: { ids } }) => ids, {
	query: t.Object({
		ids: t.Union([
			t.Array(t.Union([t.Object({ a: t.String() }), t.Numeric()])),
			t.Numeric()
		])
	})
})

const response = await app
	.handle(req(`/?ids=1&ids=${JSON.stringify({ a: 'b' })}`))
	.then((res) => res.json())

console.log(response)
