import { Elysia, t } from '../../../src'

// Own fixture — generateCompiledArtifacts is non-idempotent on a shared app.
// Exported under neither `app` nor `default`: the AOT entry lookup must still
// find the single Elysia export. The body schema makes the route show up in
// the emitted manifest.
export const server = new Elysia().post(
	'/named',
	{
		body: t.Object({ hello: t.String() })
	},
	({ body }) => body
)

// Same instance under a second name is still one app, not an ambiguity.
export { server as api }
