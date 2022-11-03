import { z } from 'zod'
import KingWorld from '../src'
import { TypedSchema, TypedSchemaToRoute, UnwrapSchema } from '../src/types'

new KingWorld().guard(
	{
		schema: {
			query: z.object({
				username: z.string()
			})
		}
	},
	(app) =>
		app.post('/:id', ({ query, body, params }) => {}, {
			schema: {
				body: z.object({
					password: z.string()
				})
			},
			beforeHandle: ({ query, body, params }) => {}
		})
)
