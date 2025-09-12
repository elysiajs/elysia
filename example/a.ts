import { Elysia, t } from 'elysia'

new Elysia().group(
	'/id/:id',
	{
		params: t.Object({
			id: t.Number()
		})
	},
	(app) =>
		app.get('/:name', ({ params }) => params, {
			params: t.Object({
				name: t.String()
			})
		})
)
