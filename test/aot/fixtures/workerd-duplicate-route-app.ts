import { Elysia, t } from '../../../src'

export default new Elysia()
	.post('/u', { body: t.Object({ stale: t.String() }) }, ({ body }) => body)
	.post('/u', { query: t.Object({ winner: t.String() }) }, ({ query }) => query)
