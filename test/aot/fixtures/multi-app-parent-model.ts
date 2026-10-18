import { Elysia, t } from '../../../src'

// `api` refers to a model only its parent defines, so it can't be captured
// standalone: the build warns and gives it no manifest
export const api = new Elysia({ name: 'api' }).post(
	'/user',
	{ body: 'user' as any },
	({ body }) => body
)

export const app = new Elysia({ name: 'app' })
	.model({ user: t.Object({ name: t.String() }) })
	.use(api)
