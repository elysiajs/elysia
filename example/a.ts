import { Elysia, t, UnwrapSchema } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get('/', () => 'hello world')

app.handle(
	new Request('http://localhost', {
		method: 'HEAD'
	})
)
	.then((x) => x.headers.toJSON())
	.then(console.log)
