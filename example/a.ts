import { Elysia, t } from '../src'

const app = new Elysia().get('/', ({ query }) => query, {
	query: t.Object({
		id: t.Array(t.String())
	})
})

app.handle(new Request('http://localhost:3000/?id=1&id=2'))
	.then((x) => x.json())
	.then(console.log)
