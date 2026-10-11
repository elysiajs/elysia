import { Elysia, t } from '../../../src'

// Disabling stripping keeps the runtime compiler available for this validated route.
export const app = new Elysia().post(
	'/u',
	{ body: t.Object({ name: t.String(), age: t.Number() }) },
	({ body }) => body
)
