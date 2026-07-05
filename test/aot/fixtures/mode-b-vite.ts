import { Elysia, t } from '../../../src'

// Mode B candidate for the src-based Vite hook-contract test. A UNION body keeps
// this genuinely WIRED: a union is not bridge-free (`u`), so the sealed mode is
// forbidden and the bridge must be re-routed to the mirror. (Query Numeric
// coercion alone no longer forces the wired mirror — slot-level scalar coercion
// is now bridge-free; see bridge-free-slots.test.ts — so this fixture needs a
// non-coverable schema to stay a valid wired control, mirroring mode-b-app.ts.)
export const app = new Elysia()
	.get('/n', { query: t.Object({ n: t.Numeric() }) }, ({ query }) => query.n)
	.post(
		'/u',
		{
			body: t.Union([
				t.Object({ a: t.String() }),
				t.Object({ b: t.Number() })
			])
		},
		({ body }) => body
	)
