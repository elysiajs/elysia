import { Elysia, file } from '../src'
import Page from './index.html'

/**
 * Example of handle single static file
 *
 * @see https://github.com/elysiajs/elysia-static
 */
new Elysia()
	.headers({
		server: 'Elysia'
	})
	.onRequest(({ request }) => {
		console.log(request.method, request.url)
	})
	.get('/', Page)
	.get('/tako', file('./example/takodachi.png'))
	.get('/mika.mp4', Bun.file('test/kyuukurarin.mp4'))
	.listen(3000)
