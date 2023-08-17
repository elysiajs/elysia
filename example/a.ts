import { Elysia, t } from '../src'

new Elysia({ aot: false })
	.get('/', ({ query }) => "Hi", {
		query: t.Object({
			redirect_uri: t.String()
		})
	})
	.onResponse(({ set }) => {
		console.log(set)
	})
	.listen(8080)
