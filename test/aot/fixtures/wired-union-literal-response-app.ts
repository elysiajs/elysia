import { Elysia, t } from 'elysia'

// #2024: a union-literal response needs the wired TypeBox bridge and keeps
// the cookie jar (response mapping), so `cookie/*` sits in the bundle
export const app = new Elysia().get(
	'/',
	{
		response: t.Object({
			status: t.Union([t.Literal('ok'), t.Literal('degraded')])
		})
	},
	() => ({ status: 'ok' as const })
)
