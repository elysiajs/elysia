import KingWorld, { KingWorldInstance, TypedSchema } from '../src'
import { z, ZodObject } from 'zod'

const a = z.object({
	name: z.string()
})

new KingWorld()
	.state('name', 'salt')
	.get('/', ({ store: { name } }) => `Hi ${name}`, {
		schema: {
			query: z.object({
				name: z.string()
			})
		}
	})
	// If query 'name' is not preset, skip the whole handler
	.guard(
		{
			schema: {
				query: z.object({
					name: z.string()
				})
			}
		},
		(app) =>
			app
				// Query type is inherited from guard
				.get('/profile', ({ query: { name } }) => `Hi ${name}`)
				// Store is inherited
				.post('/name', ({ store: { name } }) => name, {
					schema: {
						body: z.object({
							id: z.number().min(5),
							username: z.string(),
							profile: z.object({
								name: z.string()
							})
						})
					}
				})
	)
	.listen(3000)
