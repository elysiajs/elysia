import { Elysia, t } from '../src'

new Elysia()
	.macro({
		a: {
			resolve: () => ({
				query: {
					age: 17
				}
			})
		}
	})
	.get(
		'/',
		({ query }) => {
			query
		},
		{
			query: t.Object({
				name: t.String()
			})
		}
	)
