import { Elysia, status, t } from '../src'
import z from 'zod'

const app = new Elysia()
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
			return status(404, 'Thing')
		},
		{
			a: true,
			response: {
				200: t.Literal("Q"),
				403: t.Literal('Forbidden')
			},
			query: t.Object({
				name: t.String()
			})
		}
	)

type A = (typeof app)['~Routes']['get']['response']
