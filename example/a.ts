import { Elysia, t } from '../src'

export const app = new Elysia()
	.macro({
		a: {
			query: t.Object({
				id: t.Number()
			}),
			detail: {
				summary: 'a'
			},
			afterHandle({ query }) {

			}
		}
	})
	.get('/', ({ query }) => query, {
		a: true,
		query: t.Object({
			name: t.String()
		}),
	})
