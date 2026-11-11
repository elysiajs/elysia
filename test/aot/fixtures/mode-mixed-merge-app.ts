import { Elysia, t } from 'elysia'
import { z } from 'zod'
// A merge Standard Schema route with a TypeBox query slot stays wired.
export const app = new Elysia().guard(
	{ schema: 'merge', body: z.object({ name: z.string() }) },
	(app) =>
		app.post(
			'/u',
			{ query: t.Object({ q: t.String() }) },
			({ body }) => body
		)
)
