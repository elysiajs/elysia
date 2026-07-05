import { Elysia, t } from 'elysia'

// A query-coercion app whose ONLY validators are slot-level scalar coercions the
// user wrote explicitly (Numeric / BooleanString). Before slot-coercion coverage
// these forced the wired bridge (mode B); now every validator is bridge-free, so
// the build promotes to `sealed` (mode A) and TypeBox collapses out of the bundle.
export const app = new Elysia()
	.get(
		'/search',
		{
			query: t.Object({
				n: t.Numeric(),
				b: t.BooleanString(),
				s: t.String()
			})
		},
		({ query }) => query
	)
	.get(
		'/user/:id',
		{ params: t.Object({ id: t.Numeric() }) },
		({ params }) => params
	)
