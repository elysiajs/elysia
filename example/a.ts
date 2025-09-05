import { Elysia, t, UnwrapSchema } from '../src'
import z from 'zod'

const app = new Elysia()
	.model({
		id: z.object({
			id: z.number()
		}),
		id2: t.Object({
			id: t.Number()
		})
	})
	.post('/', ({ body }) => body, {
		body: 'id2'
	})
	.listen(3000)

type A = UnwrapSchema<'id2', typeof app['~Definitions']['typebox']>
