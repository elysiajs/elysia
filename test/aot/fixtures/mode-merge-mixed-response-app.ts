import { Elysia, t } from 'elysia'
import { z } from 'zod'

// A merge Standard Schema route with a TypeBox response slot stays wired.
export const app = new Elysia().guard(
	{
		schema: 'merge',
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
