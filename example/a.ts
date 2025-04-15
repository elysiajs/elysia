import { Elysia } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/ws', () => 'hi')
	.ws('/ws', {
		message() {}
	})
	.listen(3000)

console.log(app.routes[0].compile().toString())
