import { Elysia, t } from '../src'
import { randomId } from '../src/utils'

new Elysia()
	.decorate('a', 'a')
	.state('b', 'b')
	.ws('/', {
		parse(ws, body) {
			if (typeof body === 'number') return { id: body }
		},
		resolve: () => ({
			requestId: ~~(Math.random() * 1000000)
		}),
		open({ subscribe, id }) {
			subscribe('a')
		},
		message: function* ({ body: { id }, data: { requestId }, send, id: reId }) {
			yield { id: requestId }
		},
		body: t.Object({
			id: t.Number()
		}),
		response: t.Object({
			id: t.Number()
		})
	})
	.listen(3000)
