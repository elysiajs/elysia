import { Elysia, t } from '../../../src'

// The guard follows the last route, so no route sees its schema, yet
// registering it still snapshots the schema
export const app = new Elysia()
	.get('/', 'ok')
	.guard({ headers: t.Object({ a: t.String() }) })
