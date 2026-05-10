import z from 'zod'
import { Elysia, t } from '../src'

const app = new Elysia()
	.model({
		response: z.boolean()
	})
	.get(
		'/:name',
		({ params: { name } }) => (name === 'lilith' ? undefined : true),
		{
			response: 'response'
		}
	)

console.log(app.handler(0, true).toString())

const exists = await app.handle('/fouco')
const nonExists = await app.handle('/lilith')

console.log(exists)
console.log(nonExists)
