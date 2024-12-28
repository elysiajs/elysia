import { Elysia, t, error, StatusMap } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.macro({
		user: (enabled: boolean) => ({
			resolve: ({ query: { name = 'anon' } }) => ({
				user: {
					name
				}
			})
		})
	})
	.get('/', ({ user }) => user, {
		user: true
	})

const [a, b] = await Promise.all([
	app.handle(req('/')).then((x) => x.json()),
	app.handle(req('/?name=hoshino')).then((x) => x.json())
])

console.log(a, b)
