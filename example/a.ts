import { Elysia, t } from '../src'

export const app = new Elysia().group(
	'/id/:id',
	{
		params: t.Object({
			id: t.Numeric()
		}),
		beforeHandle({ params }) {}
	},
	(app) => app.get('/awd', ({ params }) => {})
)
