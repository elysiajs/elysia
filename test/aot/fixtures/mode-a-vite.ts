import { Elysia, t } from '../../../src'

// Mode A candidate for the src-based Vite hook-contract test (src plugin shares
// the src `Compiled`). Only a bridge-free body route → sealed.
export const app = new Elysia().post(
	'/u',
	{ body: t.Object({ name: t.String(), age: t.Number() }) },
	({ body }) => body
)
