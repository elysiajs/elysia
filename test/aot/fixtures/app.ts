import { Elysia, t } from '../../../src'

// Build entrypoint AND the app the plugin captures (entry === app, like a real
// single-file app). `ELYSIA_AOT_BUILD` makes `.listen()` a no-op during capture.
export const app = new Elysia()
	.post('/body', ({ body }) => body, {
		body: t.Object({ hello: t.String() })
	})
	.post('/echo', ({ body }) => body, {
		// same shape as /body → must dedup to one factory
		body: t.Object({ hello: t.String() })
	})
	.get('/q', ({ query }) => query, {
		query: t.Object({ id: t.Optional(t.Number()) })
	})

if (!process.env.ELYSIA_AOT_BUILD) app.listen(3000)
