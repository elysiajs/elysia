import { Elysia, t } from '../src'
import Index from './index.html'

const app = new Elysia()
	.get(
		'/',
		Index,
		{
			response: t.Object(
				{ keys: t.Array(t.Object({ a: t.Number() })) },
				{ additionalProperties: true }
			)
		}
	)
	.listen(3000)

// console.log(app.routes[0].compile().toString())
