import { Elysia, t } from 'elysia'

// Mode A candidate: only a body-validated plain-object route (bridge-free) plus
// a schemaless GET. Every captured validator is bridge-free → sealed.
export const app = new Elysia()
	.post(
		'/u',
		{ body: t.Object({ name: t.String(), age: t.Number() }) },
		({ body }) => body
	)
	.get('/', () => 'hi')
