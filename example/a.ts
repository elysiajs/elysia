import { Elysia, t } from '../src/2'

const app = new Elysia().get(
	'/:id/a',
	({ body, params: { id } }) => {
		console.log(typeof id)

		return id ?? 'Hello'
	},
	{
		params: t.Object({
			id: t.Number()
		})
	}
)

// console.log(app.routes[0].compile().toString())

Bun.serve({
	port: 3000,
	fetch: app.fetch
})
