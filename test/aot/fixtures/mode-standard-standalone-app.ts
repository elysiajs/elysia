import { Elysia } from 'elysia'
import { z } from 'zod'

// Standalone (`schema: 'standalone'`) with a Standard Schema body. Standalone
// schemas live under `hook.schemas`, NOT the named slots. When EVERY standalone
// slot is a Standard Schema (and the route has no TypeBox direct slot), the
// route reconstructs entirely through `RouteValidator` -> `StandardValidator`
// without touching the bridge, so the gate may seal it.
export const app = new Elysia().guard(
	{
		schema: 'standalone',
		body: z.object({ name: z.string(), age: z.number() })
	},
	(app) => app.post('/u', ({ body }) => body)
)
