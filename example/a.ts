import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia()
	.get(
		'/',
		() => {
			return {
				username: 'a',
				password: 'b',
				alias: 'saltyaom'
			}
		},
		{
			response: t.Object({
				username: t.String(),
				password: t.String()
			})
		}
	)
	.listen(3000)

console.log(app.routes[0].compile().toString())
