import { Elysia, t } from '../../../src'

export const app = new Elysia().post(
	'/u',
	{ body: t.Object({ name: t.String(), age: t.Number() }) },
	({ body }) => body
)
