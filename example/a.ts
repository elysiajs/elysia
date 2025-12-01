import { Elysia, t } from '../src'
import * as z from 'zod'
import { post, req } from '../test/utils'

const app = new Elysia()
	.guard({
		schema: 'standalone',
		body: z.object({
			data: z.any()
		})
	})
	.post('/', ({ body }) => ({ body, win: {}.foo }), {
		body: z.object({
			data: z.object({
				messageId: z.string('pollute-me')
			})
		})
	})
	.get('/cold-route', () => 'hello world')
	.listen(3000)

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
