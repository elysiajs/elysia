import { Elysia, t } from '../src'

new Elysia()
	.model({
		ids: t.Object({
			ids: t.Array(t.Union([t.String(), t.ArrayString()]))
		})
	})
	.get('/', ({ query }) => query, {
		query: 'ids'
	})
