import { Elysia, t, status } from 'elysia'
import { z } from 'zod'

// e2e variant: the handler can emit a 400. The 400 body is validated against the
// frozen TypeBox response schema. Under seal (TypeBox dropped) that frozen slot
// must still run — a malformed 400 body → 422 (response validation), not a
// silent pass or a 500.
export const app = new Elysia().post(
	'/u',
	{
		body: z.object({ name: z.string(), age: z.number() }),
		response: {
			200: z.object({ name: z.string(), age: z.number() }),
			400: t.Object({ error: t.String() })
		}
	},
	({ body, query }) => {
		if ((query as Record<string, unknown>).bad === '1')
			// violates the 400 schema (`error` must be a string)
			return status(400, { wrong: 123 } as never)
		return body
	}
)
