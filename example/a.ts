import { Elysia } from '../src'
import z from 'zod'
import * as v from 'valibot'

new Elysia()
	.guard({
		schema: 'standalone',
		body: z.object({
			id: z.coerce.number()
		})
	})
	.get('/user/:id', ({ body }) => body, {
		body: v.object({
			name: v.literal('lilith')
		})
	})
