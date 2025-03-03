import { Elysia, t } from '../src'
import { sucrose } from '../src/sucrose'
import { req } from '../test/utils'

const app = new Elysia().get(
	'/',
	({ error }) => error(418, { name: 'Nagisa', hifumi: 'daisuki' }),
	{
		response: {
			200: t.Object({
				hello: t.String()
			}),
			418: t.Object({
				name: t.Literal('Nagisa')
			})
		}
	}
)

const response = await app.handle(req('/')).then((x) => x.json())
