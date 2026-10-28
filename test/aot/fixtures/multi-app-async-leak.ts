import { Elysia, t } from '../../../src'

// The hidden sub-app serves before its async module settles, so it rebuilds
// its router when that settles, while the build captures `app`: none of it may
// reach `app`'s manifest, neither `/hidden` nor its `/b` codec and custom error
const sub = new Elysia({ precompile: true })
	.use(import('./multi-app-async-plugin'))
	.post('/hidden', { body: t.Object({ n: t.Numeric() }) }, ({ body }) => body)
	.post(
		'/b',
		{
			body: t.Object({
				data: t.ObjectString({ admin: t.Boolean() }),
				role: t.String({ error: 'SUB-CUSTOM' })
			})
		},
		({ body }) => body
	)

export const app = new Elysia({ name: 'app' })
	.use(import('./multi-app-async-plugin'))
	.post(
		'/b',
		{ body: t.Object({ data: t.String(), role: t.String() }) },
		({ body }) => body
	)
	.mount('/sub', sub.fetch)

void sub.handle('/b')
