import { Elysia, t } from '../../../src'

// No route reads cookies, so request-side parsing, jars, and signing may be stripped.
export const app = new Elysia().post(
	'/echo',
	{ body: t.Object({ name: t.String() }) },
	({ body }) => body
)
