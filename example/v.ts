import { Elysia, t } from '../src'

new Elysia()
	.post('/body', ({ body }) => body, {
		schema: {
			headers: t.Object({
				username: t.String(),
				password: t.String()
			})
		}
	})
	.post('/header', ({ request: { headers } }) => 'welcome back', {
		schema: {
			headers: t.Object({
				authorization: t.String()
			})
		}
	})
	.listen(3000)
