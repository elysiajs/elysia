import { Elysia } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/', function* ({ set }) {
		return 'hello'
	})
	.get('/json', function* ({ set }) {
		return { hello: 'world' }
	})

const response = await Promise.all([
	app.handle(req('/')),
	app.handle(req('/json'))
])

console.log(response[0].headers.get('content-type'))
