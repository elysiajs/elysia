import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get('/', ({ query }) => query, {
	query: t.Object({
		a: t.Array(t.Number())
	})
})

// console.log(
// 	t.Object({
// 		a: t.Array(t.Numeric())
// 	}),
// 	{
// 		depth: null
// 	}
// )

const response = await app.handle(req('/?a=1,2')).then((x) => x.status)

console.log(response)
