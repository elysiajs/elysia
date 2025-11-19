import { Elysia } from '../src'

new Elysia()
	.parser('a', ({ contentType }) => {

	})

// const app = new Elysia().get('/', () => `▲`).listen(3000)
