import { Elysia, t } from '../src'
import { randomId } from '../src/utils'

new Elysia()
	.decorate('a', 'a')
	.state('b', 'b')
	.ws('/', {
		// parse(ws, body) {
		// 	if (typeof body === 'number') return { id: body }
		// },
		message({ send, body }) {
			// console.log({ body })

			send(1)
		},
		body: t.Object({
			id: t.Number()
		}),
		response: t.Object({
			id: t.Number()
		})
	})
	.listen(3000)
