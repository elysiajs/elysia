import { Elysia, t } from '../../../src'

// Own fixture — generateCompiledArtifacts is non-idempotent on a shared app.
// A coerced query schema seals a coercion-carrying validator, which is what
// triggers the compact-error warning during capture.
export const app = new Elysia().get(
	'/coerced',
	{
		query: t.Object({ n: t.Numeric() })
	},
	({ query }) => query
)
