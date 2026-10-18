import { Elysia, t } from '../../../src'

// A mounted sub-app named and exported gets its own manifest
export const sub = new Elysia({ name: 'sub' }).post(
	'/hidden',
	{ body: t.Object({ n: t.Number() }) },
	({ body }) => body
)

export const app = new Elysia({ name: 'app' })
	.mount('/x', sub.fetch)
	.get('/', () => 'root')
