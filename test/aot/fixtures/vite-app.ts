import { Elysia, t } from '../../../src'

// Separate entry for the vite hook test: `generateCompiledModule` memoizes
// `app.compile()`, so it's non-idempotent on a shared app (the first capture
// wins). The bundler tests get fresh app imports; the vite test calls it directly
// (like the core test), so it needs its own app to capture a real manifest.
export const app = new Elysia().post(
	'/v',
	{
		body: t.Object({ v: t.Number() })
	},
	({ body }) => body
)

if (!process.env.ELYSIA_AOT_BUILD) app.listen(3000)
