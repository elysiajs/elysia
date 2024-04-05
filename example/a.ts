import { Elysia, t } from '../src'
import { InferContext } from '../src/types'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true }).get(
	'/',
	({ cookie: { profile } }) => {
		profile.value = 'a'
	},
	{
		cookie: t.Cookie({
			profile: t.String()
		}, {
			secrets: 'awd'
		})
	}
)

type Context = InferContext<Elysia>

app.handle(req('/'))
	.then((x) => x.text())
	.then((x) => console.log({ x }))
