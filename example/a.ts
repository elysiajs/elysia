import { Elysia, t } from '../src'

new Elysia().get(
	'/:id',
	({ body }) => {
		return 'ok'
	},
	{
		body: t.Object({
			id: t.Number()
		})
	}
)
