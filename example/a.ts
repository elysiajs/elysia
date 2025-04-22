import { Elysia, t } from '../src'

const a = {
	200: 'a'
}

const app = new Elysia()
	.decorate({
		'a b': 'a'
	})
	.get('/', () => 'a')
	.post('/', ({ body }) => ({ a: 'hello world' }), {
		response: t.Object({
			a: t.String()
		})
	})
	// .compile()
	.listen(3000)

// console.log(app.routes[0].compile().toString())
