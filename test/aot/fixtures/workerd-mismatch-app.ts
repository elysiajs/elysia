import { Elysia, t } from '../../../src'

export default new Elysia().post(
	'/u',
	{ body: t.Object({ value: t.String() }) },
	({ body }) => body
)
