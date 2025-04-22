import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', ({ body }) => ({ a: 'hello world' }), {
		body: t.Object({
			a: t.String()
		})
	})
	// .compile()
	.listen(3000)

console.log(app.routes[0].compile().toString())
