import { Elysia, t } from '../../../src'

// built without REPLAY_DRIFT, run with it: adds an auth hook and a
// tighter body schema the build never saw
const drift = !!process.env.REPLAY_DRIFT

export const app = new Elysia()
if (drift) app.onBeforeHandle(() => new Response('DENIED', { status: 401 }))

app.get('/secret', () => 'SECRET').post(
	'/body',
	{
		body: t.Object({ n: drift ? t.Number({ maximum: 10 }) : t.Number() })
	},
	({ body }) => body
)
