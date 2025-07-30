import Elysia, { NotFoundError, t } from '../src'
import { req } from '../test/utils'

const route = new Elysia().get('/', ({ query: { aid } }) => aid, {
	query: t.Object({
		aid: t
			.Transform(t.String())
			.Decode((value) => {
				throw new NotFoundError('foo')
			})
			.Encode((value) => `1`)
	})
})

let response = await new Elysia({ aot: true })
	.use(route)
	.handle(req('/?aid=a'))

console.log(response.status)
