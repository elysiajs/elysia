import { Elysia, t, file, form } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/', 'a', {
		response: t.String()
	})
	.listen(3000)

// app._routes.post.response
