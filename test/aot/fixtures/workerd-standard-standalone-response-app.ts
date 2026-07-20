import { Elysia } from '../../../src'
import { z } from 'zod'

export default new Elysia().guard(
	{
		schema: 'standalone',
		response: {
			200: z.object({ ok: z.boolean() }),
			400: z.object({ error: z.string() })
		}
	},
	(app) => app.get('/response', () => ({ ok: true }))
)
