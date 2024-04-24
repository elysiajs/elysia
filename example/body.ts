import { Elysia, t } from '../src'

const app = new Elysia()
	// Add custom body parser
	.onParse(async ({ request, contentType }) => {
		switch (contentType) {
			case 'application/Elysia':
				return request.text()
		}
	})
	.post('/', ({ body: { username } }) => `Hi ${username}`, {
		body: t.Object({
			id: t.Number(),
			username: t.String()
		})
	})
	// Increase id by 1 from body before main handler
	.post('/transform', ({ body }) => body, {
		transform: ({ body }) => {
			body.id = body.id + 1
		},
		body: t.Object({
			id: t.Number(),
			username: t.String()
		}),
		detail: {
			summary: 'A'
		}
	})
	.post('/mirror', ({ body }) => body)
	.listen(3000)

console.log('🦊 Elysia is running at :8080')
