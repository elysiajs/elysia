import { Elysia, t } from '../src'
import { post } from '../test/utils'

const app = new Elysia({
	aot: false
})
	.get('/id/:id', ({ params: { id } }) => typeof id, {
		params: t.Object({
			id: t.Numeric()
		})
	})
	.listen(3000)
