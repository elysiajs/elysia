import KingWorld from '../src'
import { z } from 'zod'

const app = new KingWorld()
	// Strictly validate response
	.get('/', () => 'hi', {
		schema: {
			response: z.string()
		}
	})
	// Strictly validate body and response
	.post('/', ({ body }) => body.id, {
		schema: {
			body: z.object({
				id: z.number().min(5),
				username: z.string(),
				profile: z.object({
					name: z.string()
				})
			}),
			response: z.number()
		}
	})
	// Strictly validate query, params, and body
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
