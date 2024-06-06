import { Elysia, t } from '../src'

const app = new Elysia().post('/', () => {}, {
	body: t.Object({
		id: t.Numeric()
	})
})

app.handle(
	new Request('http://localhost:3000', {
		method: 'POST'
	})
)
	.then((x) => x.json())
	.then(console.dir)
