import { Elysia, t } from '../src'

new Elysia({ precompile: true })
	.get('/', ({ query }) => query)
	.compile()

// app.handle(new Request('http://localhost'))
// 	.then((x) => x.headers.getSetCookie())
// 	.then(console.log)
