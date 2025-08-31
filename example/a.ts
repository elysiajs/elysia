import { Elysia, t } from '../src'
import { z } from 'zod'
import * as v from 'valibot'
import { type } from 'arktype'

new Elysia()
	.guard({
		schema: 'standalone',
		body: z.object({
			age: z.coerce.number()
		})
	})
	.guard({
		schema: 'standalone',
		body: v.object({
			vali: v.literal('vali')
		})
	})
	.guard({
		schema: 'standalone',
		body: type({
			'+': 'delete',
			ark: '"type"'
		})
	})
	.post('/', ({ body }) => body, {
		body: t.Object({
			name: t.String()
		})
	})
	.listen(3000)
