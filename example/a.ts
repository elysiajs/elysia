import { Elysia, t } from '../src'
import { req } from '../test/utils'

const Auth = new Elysia({ name: 'auth' })
	.mount('/ba', (request) => {
		console.log('BA', request.url)
		return new Response('A')
	})
	.mount('/auth', (request) => {
		console.log('AUTH', request.url)
		return new Response('AUTH')
	})

const Module = new Elysia().use(Auth)

const app = new Elysia({ name: 'main' }).use(Auth).use(Module).listen(3000)

app.handle(req('/auth')).then((x) => x.text())
