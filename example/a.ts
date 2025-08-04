import { Elysia, t } from '../src'

new Elysia()
	.get(
		'/test',
		({ query }) => {
			return query
		},
		{
			query: t.Object({
				limit: t.Optional(
					t.Number({ minimum: 10, maximum: 100, default: 25 })
				)
			})
		}
	)
	.listen(3000)
