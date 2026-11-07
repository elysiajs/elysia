import { Elysia, t } from 'elysia'

// Sealed, with a coercing query: its build path reaches the lazy TypeBox loader
export const app = new Elysia()
	.post(
		'/json',
		{ body: t.Object({ name: t.String(), age: t.Number() }) },
		({ body }) => body
	)
	.get(
		'/search',
		{ query: t.Object({ page: t.Number(), limit: t.Number() }) },
		({ query }) => query
	)
