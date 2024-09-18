import { Elysia, t } from '../src'

new Elysia()
	.ws('/', {
		open: (ws) => {
			ws.publish('channel', 'hello')
		},
		response: t.String()
	})
	.listen(3000)

// app.handle(new Request('http://localhost'))
// 	.then((x) => x.headers.getSetCookie())
// 	.then(console.log)
