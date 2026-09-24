import { Elysia, t } from '../../../src'

// Source imports share Compiled with the Vite plugin; this body schema can seal.
export const app = new Elysia().post(
	'/u',
	{ body: t.Object({ name: t.String(), age: t.Number() }) },
	({ body }) => body
)
