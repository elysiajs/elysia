import { Elysia, t } from 'elysia'

// a cookie route keeps the cookie jar, the union body wires the TypeBox bridge
export const app = new Elysia()
	.get('/', ({ cookie: { a } }) => a.value ?? 'none')
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
