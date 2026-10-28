import { Elysia, t } from 'elysia'

// The union body requires the wired TypeBox bridge.
export const app = new Elysia()
	.get('/n', { query: t.Object({ n: t.Numeric() }) }, ({ query }) => query.n)
	.post(
		'/u',
		{
			body: t.Union([
				t.Object({ a: t.String() }),
				t.Object({ b: t.Number() })
			])
		},
		({ body }) => body
	)
