import { Elysia, t } from '../src'

export const app = new Elysia()
	.macro({
		a: {
			query: t.Object({
				id: t.String()
			}),
			response: {
				404: t.Literal('Thing')
			},
			detail: {
				summary: 'a'
			},
			beforeHandle({ status }) {
				if (Math.random() > 0.5) return status(201)
			}
		}
	})
	.get(
		'/',
		({ query, status }) => {
			return status(403, 'Forbidden')
		},
		{
			a: true,
			response: {
				403: t.Literal('Forbidden')
			}
			// query: t.Object({
			// 	name: t.String()
			// })
		}
	)

type A = (typeof app)['~Routes']['get']['response']
