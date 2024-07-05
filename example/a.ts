import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get('/', ({ query: { user } }) => user, {
	query: t.Optional(
		t.Object({
			user: t.Object({
				id: t.Number(),
				name: t.String()
			})
		})
	)
})

app
	.handle(
		req(
			`?user=${JSON.stringify({
				id: 1,
				name: 'test'
			})}`
		)
	)
	.then((res) => res.json())
	.then(console.log)
