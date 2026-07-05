import { Elysia, t } from 'elysia'

// Mode B candidate: query Numeric coercion (codec `k` → not bridge-free) forces
// the wired mirror. Plus a union body (also not bridge-free).
export const app = new Elysia()
	.get('/n', { query: t.Object({ n: t.Numeric() }) }, ({ query }) => query.n)
	.post(
		'/u',
		{ body: t.Union([t.Object({ a: t.String() }), t.Object({ b: t.Number() })]) },
		({ body }) => body
	)
