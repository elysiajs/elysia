import { Elysia, t } from 'elysia'

// DEFECT 1 (standalone guard): a standalone-guard schema lives under
// `hook.schemas`, NOT the 6 named slots. `buildFrozenRouteValidator` REFUSES any
// route whose `hook.schemas` is set (frozen-validator.ts:340), so this route can
// never go bridge-free — it must be `wired`, never `sealed`.
export const app = new Elysia().guard(
	{
		schema: 'standalone',
		body: t.Object({ name: t.String(), age: t.Number() })
	},
	(app) => app.post('/u', ({ body }) => body)
)
