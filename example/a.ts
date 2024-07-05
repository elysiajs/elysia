import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get('/', ({ query: { user } }) => user, {
	query: t.Object({
		user: t.Object({
			id: t.Number(),
			name: t.String()
		})
	})
})

console.log(app.routes[0].hooks.query.properties.user)

app
	.handle(
		req(
			`?user=${JSON.stringify({
				id: '2',
				name: 'test'
			})}`
		)
	)
	.then((res) => res.json())
	.then(console.log)
