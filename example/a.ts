import { Elysia, error } from '../src'
import { post, req } from '../test/utils'

export const app = new Elysia({
	precompile: true
})
	.get('/a', ({ query: { a, c } }) => 'Hello World')
	.post('/b', ({ query: { a, c } }) => 'Hello World')
	.post('/c', ({ query: { a, c } }) => 'Hello World')
	.get('/a', ({ query: { a, c } }) => 'Hello World')
	.post('/d', ({ query: { a, c } }) => 'Hello World')
	.listen(3000)

console.log(app.routeTree)

// app.handle(req('/profile'))
// 	.then((t) => t.text())
// 	.then(console.log)

// app.handle(req('/a'))
// 	.then((t) => t.text())
// 	.then(console.log)
