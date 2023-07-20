import { Elysia, t } from '../src'

const app = new Elysia()
	.get(
		'/qtest',
		({ query }) => {
			return {
				query
			}
		},
		{
			transform({ query }) {
				console.log(query)
			},
			query: t.Object({
				pageNum: t.Optional(t.Numeric({ default: 1 })),
				pageSize: t.Optional(t.Numeric({ default: 10 }))
			})
		}
	)
	.listen(3000)
