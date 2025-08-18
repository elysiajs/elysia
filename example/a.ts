import { Elysia, t } from '../src'

const IdsModel = new Elysia().model({
	ids: t.Object({
		ids: t.Array(t.String())
	})
})

const app = new Elysia({ aot: false })
	.use(IdsModel)
	.get('/', ({ query }) => query, {
		query: 'ids'
	})
	.listen(3000)
