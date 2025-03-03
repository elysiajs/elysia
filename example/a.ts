import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get(
	'/',
	() => {
		return {
			hello: 'world'
		}
	},
	{
		response: t.Object({
			hello: t.String({
				sanitize: true
			})
		})
	}
)

const response = await app.handle(req('/')).then((x) => x.json())

console.log(response)

console.log(app.routes[0].compile().toString())
