import { Elysia, t } from '../src'
import { swagger } from '@elysiajs/swagger'

new Elysia()
	// @ts-ignore
	.use(swagger)
	.get('/id/:id', ({ params: { id } }) => id)
	.post("/", ({ body }) => body, {
		body: t.Object({
			hello: t.String()
		})
	})
	.listen(3000)
