import { Elysia, error, t } from '../src'

const app = new Elysia({ precompile: true })
	.headers({
		a: 'hello'
	})
	.get('/', 'a')
	.listen(3000)

console.log(app.routes[0].composed?.toString())
