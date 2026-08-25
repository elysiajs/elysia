import { Elysia, t, status } from 'elysia'
import { z } from 'zod'

// A malformed 400 response must still reach the frozen TypeBox response validator
// after the app seals without TypeBox.
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
			// The 400 schema requires an error string.
			return status(400, { wrong: 123 } as never)
		return body
	}
)
