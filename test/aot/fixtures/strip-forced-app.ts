import { Elysia, t } from '../../../src'

// This captured route serves without runtime handler compilation.
export const app = new Elysia().post(
	'/u',
	{ body: t.Object({ name: t.String(), age: t.Number() }) },
	({ body }) => body
)
