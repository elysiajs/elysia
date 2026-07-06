import { Elysia, t } from 'elysia'
import { z } from 'zod'

// Mixed route: a TypeBox `query` slot (captured + frozen into the manifest) and
// a Standard Schema (Zod) `body` slot (no manifest entry, reconstructed live).
// Under seal the frozen query slot comes from the manifest while the standard
// body slot is a live `StandardValidator` — both must fire. This is the
// lockstep case: the gate excludes the standard slot from `expectedSlots`, and
// `buildFrozenRouteValidator` builds the live standard validator alongside the
// frozen typebox one.
export const app = new Elysia()
	.post(
		'/u',
		{
			body: z.object({ name: z.string(), age: z.number() }),
			query: t.Object({ q: t.String() })
		},
		({ body }) => body
	)
	.get('/', () => 'hi')
