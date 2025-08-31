import { Elysia, t } from '../src'
import { z } from 'zod'
import * as v from 'valibot'
import { req } from '../test/utils'

const app = new Elysia()
	.guard({
		schema: 'standalone',
		body: z.object({
			age: z.number()
		})
	})
	.guard({
		schema: 'standalone',
		body: v.object({
			a: v.number()
		})
	})
	.guard({
		schema: 'standalone',
		body: v.object({
			b: v.number()
		})
	})
	.post('/', ({ body }) => ({ body }), {
		body: t.Object({
			name: t.String()
		})
	})
	.listen(3000)
