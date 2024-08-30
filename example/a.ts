import { Elysia, t } from '../src'

const app = new Elysia()
	.get('items/:id', ({ params: { id } }) => typeof id, {
		params: t.Object({ id: t.Number() })
	})
	.listen(3000)

// console.log(app.routes[0].composed.toString())
