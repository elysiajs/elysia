import { Elysia } from '../src'

const app = new Elysia({
	aot: false
})
	.get('/', () => "Hello")
	.post('/', () => "world")

console.log(app.meta.schema)