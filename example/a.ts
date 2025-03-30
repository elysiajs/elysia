import { Elysia, t, form, file, error } from '../src'
import { req } from '../test/utils'

const app = new Elysia({
	normalize: false
}).get(
	'/users',
	() => {
		return {
			id: 'some-id',
			username: 'user1',
			email: 'user1@example.com',
			createdAt: 1,
			updatedAt: 1,
			password: 'a'
		}
	},
	{
		response: t.Intersect(
			[
				t.Object({
					id: t.String(),
					username: t.String(),
					email: t.String()
				}),
				t.Object({
					createdAt: t.Number(),
					updatedAt: t.Number()
				})
			],
			{
				additionalProperties: false
			}
		)
	}
)

app.handle(req('/users'))
	.then((x) => x.json())
	.then(console.log)
