import { Elysia, error, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/id/:id', ({ params: { id } }) => {
		return id
	}, {
		response: t.Object({
			a: t.String()
		})
	})
	.listen(3000)
