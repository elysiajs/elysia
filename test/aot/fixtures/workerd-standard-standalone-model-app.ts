import { Elysia } from '../../../src'
import { z } from 'zod'

export default new Elysia()
	.model({ Request: z.object({ value: z.string() }) })
	.guard(
		{ schema: 'standalone', body: 'Request' },
		(app) => app.post('/request', ({ body }) => body)
	)
