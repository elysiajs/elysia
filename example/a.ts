import { Elysia, t } from '../src'
import { req } from '../test/utils'

const a = new Elysia({ precompile: true }).get(
	'/error',
	({ error }) => error("I'm a teapot", 'Kirifuji Nagisa'),
	{
		response: {
			200: t.Void(),
			418: t.Literal('Kirifuji Nagisa'),
			420: t.Literal('Snoop Dogg')
		}
	}
)

a.handle(new Request('http://localhost/error')).then(x => x.status).then(console.log)

console.log(a.routes[0].composed?.toString())
