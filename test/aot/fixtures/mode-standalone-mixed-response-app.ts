import { Elysia, t } from 'elysia'
import { z } from 'zod'

// Standalone all-standard body (hook.schemas), BUT the route ALSO declares a
// DIRECT mixed response map: 200 -> Standard Schema, 400 -> TypeBox. Under seal
// `buildFrozenRouteValidator` bails at `if (hook?.schemas) return undefined`, so
// the TypeBox 400 response slot gets NO validator -> must NOT seal.
export const app = new Elysia().guard(
	{
		schema: 'standalone',
		body: z.object({ name: z.string(), age: z.number() })
	},
	(app) =>
		app.post(
			'/u',
			{
				response: {
					200: z.object({ name: z.string(), age: z.number() }),
					400: t.Object({ error: t.String() })
				}
			},
			({ body }) => body
		)
)
