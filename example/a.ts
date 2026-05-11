import z from 'zod'
import { Elysia, t } from '../src'
import { UnwrapSchema } from '../src/types'

const app = new Elysia()
	.model({
		params: z.object({
			name: z.number()
		})
	})
	.get(
		'/:name',
		({ params }) => (name === 'lilith' ? undefined : true),
		{
			params: 'params'
		}
	)

const a = z.object({
	name: z.number()
})
