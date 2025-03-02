import { Elysia, error, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/', ({ path, request }) => {
		console.log(request)

		return path
	})
	.listen(3000)
