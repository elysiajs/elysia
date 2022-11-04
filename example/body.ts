import { z } from 'zod'
import KingWorld from '../src'

new KingWorld()
	// Add custom body parser
	.onParse(async (request) => {
		const contentType = request.headers.get('content-type') ?? ''

		switch (contentType) {
			case 'application/kingworld':
				return request.text()
		}
	})
	.post('/', ({ body: { username } }) => `Hi ${username}`, {
		// Define type strict schema, and validation
		// This type will be infer to TypeScript
		schema: {
			body: z.object({
				id: z.number(),
				username: z.string()
			})
		}
	})
	// Increase id by 1 from body before main handler
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
