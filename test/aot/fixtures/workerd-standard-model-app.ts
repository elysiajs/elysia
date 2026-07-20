import { Elysia } from '../../../src'
import { z } from 'zod'

export default new Elysia()
	.model({
		Request: z.object({ value: z.string() }),
		Response: z.object({ ok: z.boolean() })
	})
	.post(
		'/u',
		{ body: 'Request', response: 'Response' },
		() => ({ ok: true })
	)
