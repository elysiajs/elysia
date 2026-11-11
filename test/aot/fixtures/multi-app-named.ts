import { Elysia, t } from '../../../src'

// The issue's shape, both apps named: `api` is served on its own and through
// `app`, so the build registers a manifest under each name
export const api = new Elysia({ name: 'api', prefix: '/api' }).post(
	'/state',
	{ body: t.Object({ theme: t.String() }) },
	({ body }) => body
)

export const app = new Elysia({ name: 'app' }).use(api)

export default app
