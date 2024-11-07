import { Elysia, file } from '../src'

const app = new Elysia()
	.ws('/', {
		message(ws) {
			ws.send('hello')
		}
	})
	.post('/json', ({ body }) => body)
	.get('/', () => file('./test/kyuukurarin.mp4'))
	.get('/teapot', ({ set }) => {
		set.status = 418
		return file('./example/teapot.webp')
	})
	.listen(3000)
