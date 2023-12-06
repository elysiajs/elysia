import { Elysia, t, error } from '../src'

const models = new Elysia({ name: 'schema' }).model({
	bearer: t.Object({
		authorization: t.TemplateLiteral('Bearer ${string}')
	})
})

const app = new Elysia()
	.use(models.prefix('model', 'h'))
	.get(
		'/id/:id',
		(c) => (Math.random() > 0.5 ? error("I'm a teapot", 'Teapot') : 'Hi'),
		{
			query: t.Object({
				id: t.String()
			}),
			headers: 'hBearer'
		}
	)
	.listen(3000)

type Res = (typeof app)['schema']['/id/:id']['get']
