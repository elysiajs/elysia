import { Elysia } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true })
	.get('/hello', ({ cookie: { name, name2 }, redirect }) => {
		const a = new Response("A")

		// a.status = 501

		return a
	})
	.get('/world', () => {
		return 'a'
	})

console.log(app.routes[0].composed.toString())

app.handle(new Request('http://e.ly/hello'))
	.then((x) => x.status)
	.then(console.log)
