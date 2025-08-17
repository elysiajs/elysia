import { Elysia, t } from '../src'

new Elysia({ aot: false })
	.get('/', ({ query }) => query, {
		query: t.Object({
			name: t.Array(t.String())
		})
	})
	.listen(3000)
