import { Elysia, t } from '../src'
import { InferContext, InferHandler } from '../src/types'
import { req } from '../test/utils'

const setup = new Elysia({ name: 'setup' })
	.decorate('a', 'a')
	.derive(() => {
		return {
			hello: 'world'
		}
	})

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

app.handle(req('/'))
	.then((x) => x.text())
	.then((x) => console.log({ x }))
