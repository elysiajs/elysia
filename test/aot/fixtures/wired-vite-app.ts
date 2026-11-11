import { Elysia, t } from '../../../src'

// The union body keeps this source-importing Vite fixture wired.
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
