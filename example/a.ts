import { Elysia, t } from '../src'

new Elysia({ aot: false })
	.get('/', ({ query }) => {}, {
		query: t.Object({
			redirect_uri: t.Optional(t.String())
		})
	})
	.listen(8080)
