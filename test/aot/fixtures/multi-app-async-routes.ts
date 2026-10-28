import { Elysia, t } from '../../../src'

// Routes loaded by an async `.use(import(...))` in the multi-app-async fixtures
export default new Elysia().post(
	'/state',
	{ body: t.Object({ theme: t.String() }) },
	({ body }) => body
)
