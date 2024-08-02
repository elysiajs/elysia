import { Elysia, t } from '../src'

new Elysia()
	.guard({
		query: t.Object({
			id: t.Number()
		})
	})
	.derive(({ query }) => {
		return {
			query
		}
	})
