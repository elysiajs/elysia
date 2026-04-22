import { Elysia, t } from '../src/2'

const app = new Elysia()
	.onError(({ error, query }) => {
		console.log(query)
	})
	.get('/query', (c) => c.query.name, {
		query: t.Object({
			name: t.String()
		})
	})
	// .listen(3000)

app.handle('http://localhost/query?name=bb').then((res) =>
	res.text().then((text) => console.log(text))
)
