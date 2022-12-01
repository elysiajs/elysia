import { KingWorld, t } from '../src'

const app = new KingWorld()
	// Add custom body parser
	.onParse(async (request, contentType) => {
		switch (contentType) {
			case 'application/kingworld':
				return request.text()
		}
	})
	.post('/', ({ body: { username } }) => `Hi ${username}`, {
		schema: {
			body: t.Object({
				id: t.Number(),
				username: t.String()
			})
		}
	})
	// Increase id by 1 from body before main handler
	.post('/transform', ({ body }) => body, {
		transform: ({ body }) => {
			body.id = body.id + 1
		},
		schema: {
			body: t.Object({
				id: t.Number(),
				username: t.String()
			})
		}
	})
	.post('/mirror', ({ body }) => body)
	.listen(8080)

console.log('🦊 KINGWORLD is running at :8080')
