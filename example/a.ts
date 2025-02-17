import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get('/', ({ query }) => query, {
	query: t.Object({
		strs: t.Array(t.String()),
		nums: t.Array(t.Number())
	})
})

app.handle(req('/?strs=a,b&nums=3,4'))
	.then((x) => x.json())
	.then(console.log)
