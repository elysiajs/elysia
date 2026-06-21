import { Elysia, t } from '../../../src'

// a fully-freezable app → coverage clean → best-effort seals
export default new Elysia().post(
	'/u',
	{ body: t.Object({ n: t.Numeric() }) },
	({ body }) => body
)
