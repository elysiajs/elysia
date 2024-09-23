import { Elysia, t } from '../src'

const app = new Elysia({ precompile: true })
	.get('A', "A")
	.get('B', ({ set }) => {
		set.headers['content-type'] = 'text/plain'
	})
	.compile()
	.listen(3000)

// app.handle(new Request('http://localhost'))
// 	.then((x) => x.headers.getSetCookie())
// 	.then(console.log)
