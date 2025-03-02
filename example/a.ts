import { Elysia, error, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get(
	'/',
	() => {
		return {
			name: 'a',
			a: 'b'
		}
	},
	{
		response: {
			200: t.Object({
				name: t.String()
			})
		}
	}
)

app.handle(req('/'))
	.then((x) => x.json())
	.then(console.log)
