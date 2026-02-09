import { Elysia, status } from '../src'
import { req } from '../test/utils'

const value = { message: 'meow!' }

const app = new Elysia().get('/', ({ set }) => {
	set.headers.hello = 'world'

	return new Response('data: hello\n\ndata: world\n\n', {
		headers: {
			'content-type': 'text/event-stream',
			'transfer-encoding': 'chunked'
		},
		status: 200
	})
})

const response = await app
	.handle(new Request('http://localhost/'))
	.then((r) => r.text())

// Should NOT double-wrap with "data: data:"
console.log(response)
// expect(response).not.toContain('data: data:')
