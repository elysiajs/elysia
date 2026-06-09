import { Elysia, t } from '../src'

new Elysia()
	.post('/', ({ body }) => body, {
		body: t.Object({
			username: t.String(),
			password: t.String(),
			nested: t.Optional(
				t.Object({
					hi: t.String()
				})
			)
		}),
		error({ error }) {
			console.log(error)
		}
	})
	.listen(3000)
