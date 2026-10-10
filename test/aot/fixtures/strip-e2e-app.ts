import { Elysia, t } from '../../../src'

export const app = new Elysia().post(
	'/body',
	{ body: t.Object({ hello: t.String() }) },
	({ body }) => body
)
