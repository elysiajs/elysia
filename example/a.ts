import { Elysia, t } from '../src'
import { Memoirist } from 'memoirist'

const app = new Elysia()
	.post('/json', (c) => c.body, {
		parse: 'json',
		response: t.Object({
				hello: t.Literal('world')
			})
	})
	.listen(3000)

console.log(app.routes[0].compile().toString())
