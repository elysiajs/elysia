import { Elysia, t } from '../src'

new Elysia()
	.decorate('a', 'a')
	.state('b', 'b')
	.ws('/', {
		parse({ body }) {
			if (typeof body === 'number') return { id: body }
		},
		resolve: () => ({
			requestId: ~~(Math.random() * 1000000)
		}),
		message: function* ({ body: { id }, data: { requestId }, send }) {
			yield { id }

			send({ id: requestId }, true)
		},
		body: t.Object({
			id: t.Number()
		}),
		response: t.Object({
			id: t.Number()
		})
	})
	.listen(3000)
