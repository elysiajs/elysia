import { Elysia, t } from 'elysia'

// Imports the BARE `elysia` specifier so it resolves to the published `dist`
// layout (`.mjs`/`.js`, no `"type":"module"`) — the setup that triggers the
// esbuild CJS-fallback dual-copy the regression guards. Mixed GET + POST so the
// Bun adapter (and its `memory` import — the module the sucrose stub replaces)
// stays reachable in the bundle graph.
export const app = new Elysia()
	.post(
		'/u',
		{ body: t.Object({ name: t.String(), age: t.Number() }) },
		({ body }) => body
	)
	.get('/', () => 'hi')
