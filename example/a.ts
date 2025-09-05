import { Elysia } from '../src'

const app = new Elysia()
	.all('/ws', () => 'hi')
	.ws('/ws', {
		message() {}
	})
	.listen(3000)

console.log(app.fetch.toString())
