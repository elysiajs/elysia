import { Elysia, t } from '../src'

const app = new Elysia()
	.guard(
		{
			schema: {
				query: t.Object({
					name: t.String()
				})
			}
		},
		(app) =>
			app
				// Store is inherited
				.post('/user', ({ query: { name } }) => name, {
					schema: {
						body: t.Object({
							id: t.Number(),
							username: t.String(),
							profile: t.Object({
								name: t.String()
							})
						})
					}
				})
	)
	.listen(8080)

const body = JSON.stringify({
	id: 6,
	username: '',
	profile: {
		name: 'A'
	}
})

const invalidBody = await app.handle(
	new Request('http://localhost/user?name=salt', {
		method: 'POST',
		body: JSON.stringify({
			id: 6,
			username: '',
			profile: {}
		})
	})
)

invalidBody.text().then(console.log)
console.log(invalidBody.status)
