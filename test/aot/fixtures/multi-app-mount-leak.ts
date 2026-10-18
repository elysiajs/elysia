import { Elysia, t } from '../../../src'

// `sub.fetch` builds the hidden sub-app while the build imports the entry: its
// routes, `/q` included with another schema, must stay out of `app`'s manifest
const sub = new Elysia({ precompile: true })
	.post('/hidden', { body: t.Object({ n: t.Numeric() }) }, ({ body }) => body)
	.get(
		'/q',
		{ query: t.Object({ page: t.Numeric({ default: 7 }) }) },
		({ query }) => query
	)

export const app = new Elysia()
	.get('/q', { query: t.Object({ page: t.String() }) }, ({ query }) => query)
	.mount('/sub', sub.fetch)
