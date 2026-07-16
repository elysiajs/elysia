import { Elysia, t } from 'elysia'

// Standalone guard schemas live under hook.schemas and require wired validation.
export const app = new Elysia().guard(
	{
		schema: 'standalone',
		body: t.Object({ name: t.String(), age: t.Number() })
	},
	(app) => app.post('/u', ({ body }) => body)
)
