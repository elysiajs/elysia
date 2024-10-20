import { Elysia, file } from '../src'
import { NodeAdapter } from '../src/adapter/node'

const app = new Elysia({ adapter: NodeAdapter })
	.post('/json', ({ body }) => body, {
		type: 'json'
	})
	.get('/kyuukurarin', () => file('./test/kyuukurarin.mp4'))
	.get('/teapot', ({ set }) => {
		set.status = 418
		return file('./example/teapot.webp')
	})
	// .get('/ok', () => {
	// 	return 'Ok'
	// })
	.compile()
	.listen(3000)
