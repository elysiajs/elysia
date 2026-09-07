import { Elysia, status, t } from 'elysia'
import { z } from 'zod'

export const app = new Elysia()
	.model({
		Success: t.Object({ ok: t.Boolean() }),
		Failure: t.Object({ error: t.String() }),
		Accepted: z.object({ accepted: z.boolean() })
	})
	.get(
		'/u',
		{
			response: {
				200: 'Success',
				202: 'Accepted',
				400: 'Failure'
			}
		},
		({ query }) => {
			const mode = (query as Record<string, unknown>).mode
			if (mode === 'valid-400')
				return status(400, { error: 'bad request' })
			if (mode === 'invalid-400')
				return status(400, { error: 400 } as never)
			if (mode === 'valid-202') return status(202, { accepted: true })

			return { ok: true }
		}
	)
	.get('/plain', () => 'second')
	.get('/standard', { response: 'Accepted' }, ({ query }) =>
		(query as Record<string, unknown>).bad === '1'
			? ({ accepted: 'no' } as never)
			: { accepted: true }
	)
