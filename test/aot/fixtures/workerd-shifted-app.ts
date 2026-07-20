import { Elysia, t } from '../../../src'

export const app = new Elysia().post(
	'/shifted',
	{ body: t.Object({ value: t.String() }) },
	({ body }) => body
)

export default app
