import { Elysia, t } from '../src'
import { z } from 'zod'
import { type } from 'arktype'
import * as v from 'valibot'

new Elysia().get(
	'/name/:name',
	({ status }) => Math.random() > 0.5
		? status(200, 'ok')
		: status(201, 'aight'),
	{
		params: type({
			name: '"hi saltyaom"'
		}),
		query: z.object({
			id: z.coerce.number()
		}),
		response: {
			200: t.Literal('ok'),
			201: v.literal('aight')
		}
	})
	.listen(3000)
