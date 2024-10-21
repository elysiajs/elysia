import { Elysia, file } from '../src'

console.log('is', typeof Bun !== "undefined" ? 'Bun' : typeof Deno !== "undefined" ? "Deno" : 'Node', '\n')

const app = new Elysia()
	.post('/json', ({ body }) => body)
	.get('/', () => file('./test/kyuukurarin.mp4'))
	.get('/teapot', ({ set }) => {
		set.status = 418
		return file('./example/teapot.webp')
	})
