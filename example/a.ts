import { Elysia, t, ws } from '../src'

const app = new Elysia()
	.use(ws())
	.ws('/', {
		message(a, b) {},
		body: t.Object({
			username: t.String()
		})
	})
	.get('/', ({ publish, query: { name } }) => name ?? 'undefined')
	.listen(3000)

app.handle(new Request('http://localhost/?name=a'))
	.then((x) => x.text())
	.then(console.log)
