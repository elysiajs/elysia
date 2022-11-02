import { z } from 'zod'
import KingWorld from '../src'

new KingWorld()
	.state('awd', 'a')
	.get('/', () => 'Hi')
	.guard(
		{
			beforeHandle: ({ query }) => {
				if (!query.name) return 'Query name is required'
			}
		},
		(app) =>
			app.get('/profile', ({ query: { name } }) => `Hi ${name}`, {
				schema: {
					query: z.object({
						name: z.string()
					})
				}
			})
	)
	.listen(3000)
