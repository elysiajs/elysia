import z from 'zod'
import { Elysia, t } from '../src'

new Elysia()
	.model({
		params: z.object({
			name: z.literal(['lilith', 'focou'])
		})
	})
	.get(
		'/:name',
		({ params: { name } }) => (name === 'lilith' ? undefined : true),
		{
			params: 'params'
		}
	)

const a = z.object({
	name: z.number()
})
