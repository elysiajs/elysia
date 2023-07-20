import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/id/:id', ({ params: { id } }) => id, {
		params: t.Object({
			id: t.Numeric({
				error: 'userId is expected to be numeric value like 1, 2, 3'
			})
		})
	})
	.get(
		'/qtest',
		({ query }) => {
			return {
				query
			}
		},
		{
			query: t.Optional(
				t.Object({
					pageNum: t.Optional(t.Numeric({ default: 1 })),
					pageSize: t.Optional(t.Numeric({ default: 10 }))
				})
			)
		}
	)
	.listen(3000)
