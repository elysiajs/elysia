import { Elysia, t } from 'elysia'
import { z } from 'zod'
// standalone all-standard BUT a typebox DIRECT slot on the same route.
// RouteValidator throws on the typebox slot under seal; frozen fallback bails on
// hook.schemas -> must NOT seal.
export const app = new Elysia().guard(
	{ schema: 'standalone', body: z.object({ name: z.string() }) },
	(app) => app.post('/u', { query: t.Object({ q: t.String() }) }, ({ body }) => body)
)
