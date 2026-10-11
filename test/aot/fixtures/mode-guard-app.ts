import { Elysia, t } from 'elysia'

// Merge guard schemas live under hook.schemas and require wired validation.
export const app = new Elysia().guard(
	{
		schema: 'merge',
		body: t.Object({ name: t.String(), age: t.Number() })
	},
	(app) => app.post('/u', ({ body }) => body)
)
