import { Elysia } from 'elysia'
import { z } from 'zod'

// Standard Schema validators reconstruct without the TypeBox bridge.
export const app = new Elysia()
	.post(
		'/u',
		{ body: z.object({ name: z.string(), age: z.number() }) },
		({ body }) => body
	)
	.get('/', () => 'hi')
