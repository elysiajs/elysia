import { Elysia } from 'elysia'
import { z } from 'zod'

// Standalone Standard Schema validators reconstruct without the TypeBox bridge.
export const app = new Elysia().guard(
	{
		schema: 'standalone',
		body: z.object({ name: z.string(), age: z.number() })
	},
	(app) => app.post('/u', ({ body }) => body)
)
