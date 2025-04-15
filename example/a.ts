import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().post('/sign-in', ({ body }) => body, {
	parse: 'json'
})

const post = new Request('http://localhost/sign-in', {
	method: 'POST',
})

console.log(app.routes[0].compile().toString())

app.handle(post.clone())
	.then((x) => x.json())
	.then(console.log)
	.catch(console.warn)
