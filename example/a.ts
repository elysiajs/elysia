import { Elysia, error } from '../src'
import { post, req } from '../test/utils'

export const app = new Elysia({
	precompile: true,
	experimental: { transpiler: true }
})
	.get('/', ({ query: { a, c } }) => 'Hello World')
	.listen(3000)

console.log(app.routes[0].composed.toString())

// app.handle(req('/profile'))
// 	.then((t) => t.text())
// 	.then(console.log)

// app.handle(req('/a'))
// 	.then((t) => t.text())
// 	.then(console.log)
