import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.model({
		a: t.String()
	})
	.model((model) => ({
		...model,
		b: t.Object({
			string: model.a
		})
	}))
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

app.handle(req('/')).then(x => x.json()).then(console.log)
