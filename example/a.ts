import { Elysia, t } from '../src/2'

const app = new Elysia()
	.get('/:id/a', ({ set }) => {
		set.headers['x-hello'] = 'world'

		return 'ok'
	})
	.post(
		'/:id/a',
		({ params: { id }, set }) => {
			set.headers['x-hello'] = 'world'

			return id ?? 'Hello'
		},
		{
			params: t.Object({
				id: t.Number()
			})
		}
	)
	.listen(3000, () => {
		console.log('Listening on http://localhost:3000')
	})
