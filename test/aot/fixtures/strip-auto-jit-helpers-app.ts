import { Elysia, t } from '../../../src'

// Handler-only codegen helpers must tree-shake when this fully captured app
// allows the handler compiler to be stripped.
export const app = new Elysia().post(
	'/u',
	{ body: t.Object({ name: t.String() }) },
	({ body }) => body
)
