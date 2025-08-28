import { Elysia, t } from '../src'
import { z } from 'zod'

const app = new Elysia()
	.get('/', ({ query }) => query, {
		query: z.object({
			x: z.array(z.string())
		})
	})
	.listen(3000)
