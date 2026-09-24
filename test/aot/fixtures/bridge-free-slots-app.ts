import { Elysia, t } from 'elysia'

// Explicit scalar coercions reconstruct from captured slots, allowing this app
// to seal without retaining TypeBox.
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
