import { z } from 'zod'
import KingWorld from '../src'

new KingWorld()
	.get('/', () => new Response('a'))
	// Add custom parser
	.onParse(async (request) => {
		const contentType = request.headers.get('content-type') ?? ''

		switch (contentType) {
			case 'application/kingworld':
				return request.text()
		}
	})
	.post('/', ({ body: { username } }) => `Hi ${username}`, {
		schema: {
			body: z.object({
				id: z.number(),
				username: z.string()
			})
		}
	})
	// Increase id by 1
	.post('/transform', ({ body }) => body, {
		transform: ({ body }) => {
			body.id = body.id + 1
		},
		schema: {
			body: z.object({
				id: z.number(),
				username: z.string()
			})
		}
	})
	.post('/mirror', ({ body }) => body)
	.listen(8080)

console.log('🦊 KINGWORLD is running at :8080')
