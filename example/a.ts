import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	// .onRequest(async () => {})
	.mount('/auth', () => new Response('OK'))
	.listen(3000)

console.log(app.router)
