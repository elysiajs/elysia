import KingWorld from '../src'
import { z } from 'zod'

const app = new KingWorld()
	.get('/', () => 'hi', {
		schema: {
			response: z.string()
		}
	})
	.post('/', ({ body }) => body.id, {
		schema: {
			body: z.object({
				id: z.number().min(5),
				username: z.string()
			}),
			response: z.number()
		}
	})
	.get('/query/:id', ({ query: { name } }) => name, {
		schema: {
			query: z.object({
				name: z.string()
			}),
			params: z.object({
				id: z.string()
			}),
			body: z.string()
		}
	})
	.listen(3000)
