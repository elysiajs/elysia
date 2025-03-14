import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia().get(
	'/',
	() => ({
		message: 'Hi' as const
	}),
	{
		response: t.NoValidate(
			t.Object({
				message: t.Literal('Hi')
			})
		)
	}
)

const result = await app.handle(req('/')).then((x) => x.json())

console.log(app.routes[0].compile().toString())
