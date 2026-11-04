import { Elysia, t } from 'elysia'

// Body and response each sanitize, so a slot that skips it is one `!` short.
export const app = new Elysia({ sanitize: (value) => value + '!' }).post(
	'/s',
	{
		body: t.Object({ name: t.String() }),
		response: t.Object({ name: t.String() })
	},
	({ body }) => body
)
