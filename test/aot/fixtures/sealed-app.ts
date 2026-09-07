import { Elysia, t } from 'elysia'

// Every captured validator is bridge-free, so this app can seal.
export const app = new Elysia()
	.post(
		'/u',
		{ body: t.Object({ name: t.String(), age: t.Number() }) },
		({ body }) => body
	)
	.get('/', () => 'hi')
