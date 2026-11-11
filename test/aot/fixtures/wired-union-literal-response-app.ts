import { Elysia, t } from 'elysia'

// #2024: a union-literal response needs the wired TypeBox bridge; nothing
// can set a cookie, so `cookie/*` is stubbed (see wired-cookie-app.ts)
export const app = new Elysia().get(
	'/',
	{
		response: t.Object({
			status: t.Union([t.Literal('ok'), t.Literal('degraded')])
		})
	},
	() => ({ status: 'ok' as const })
)
