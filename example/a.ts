import { Elysia, t } from '../src'

const app = new Elysia()
	.post('/', ({ body }) => body, {
		body: t.Union([
			t.Object({
				password: t.String()
			}),
			t.Object({
				token: t.String()
			})
		])
	})
	.listen(3000)
