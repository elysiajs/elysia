import { Elysia, error, t } from '../src'

const app = new Elysia()
	.get('/', 'a')
	.post('/', ({ body }) => 'a', {
		response: t.String(),
		body: t.Object({
			username: t.String(),
			password: t.String()
		})
	})
	.get('/id/:id', 'a')

const b = new Elysia()    .post(
	'/prefix/:id',
	() => {
		if (Math.random() > 0.5) return error(400, 'hello')

		return 'a'
	},
	{
		body: t.Object({
			username: t.String()
		}),
		headers: t.Object({
			a: t.String()
		})
	}
)


type b = typeof b

type B = b['_routes']['prefix'][':id']['post']['response']

type app = typeof app

app._routes
