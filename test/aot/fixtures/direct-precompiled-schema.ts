import { Compile } from 'typebox/compile'

import { Elysia, t } from '../../../src'

const compiled = Compile(t.Object({ value: t.String() }))

export default new Elysia().post(
	'/compiled',
	{ body: compiled as any },
	({ body }) => body
)
