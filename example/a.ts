import { Elysia, t, UnwrapSchema } from '../src'
import z from 'zod'
import { req } from '../test/utils'

const app = new Elysia().get(
	'/:name',
	({ route }) => {
		return {
			id: 'a'
		}
	},
	{
		response: z.object({
			id: z.number()
		})
	}
)

const lilith = await app.handle(req('/lilith')).then((x) => x.json())
const fouco = await app.handle(req('/fouco')).then((x) => x.json())

// console.log(app.routes[0].compile().toString())

console.log(lilith)
