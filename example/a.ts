import { Elysia, t } from '../src'
import z from 'zod'

new Elysia()
	.model({
		id: z.object({
			id: z.number()
		})
	})
	.post('/', ({ body }) => body, {
		body: 'id'
	})
	.listen(3000)
