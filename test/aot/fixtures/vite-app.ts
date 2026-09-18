import { Elysia, t } from '../../../src'

// Use a fresh app because `generateCompiledArtifacts` memoizes `app.compile()`.
export const app = new Elysia().post(
	'/v',
	{
		body: t.Object({ v: t.Number() })
	},
	({ body }) => body
)

if (!process.env.ELYSIA_AOT_BUILD) app.listen(3000)
