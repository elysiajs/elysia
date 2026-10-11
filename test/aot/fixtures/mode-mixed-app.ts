import { Elysia, t } from 'elysia'
import { z } from 'zod'

// The captured TypeBox query and live Standard Schema body must both validate
// after the app seals.
export const app = new Elysia()
	.post(
		'/u',
		{
			body: z.object({ name: z.string(), age: z.number() }),
			query: t.Object({ q: t.String() })
		},
		({ body }) => body
	)
	.get('/', () => 'hi')
