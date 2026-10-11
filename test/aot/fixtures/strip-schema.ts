import { Elysia, t } from '../../../src'

export default new Elysia().post(
	'/u',
	{ body: t.Object({ name: t.String(), age: t.Number() }) },
	({ body }) => body
)
