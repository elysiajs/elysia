import { Elysia, t } from '../src/2'

const app = new Elysia()
	.onError(({ error, query }) => {
		console.log(error)
	})
	.derive(({ query }) => {
		return {
			hello: query
		}
	})
	.get(
		'/query',
		({ hello }) => {
			return hello.name
		},
		{
			query: t.Object({
				name: t.String()
			})
		}
	)
	.listen(3000)

// console.log(app.handler(0, true).toString())

app.handle('query?name=bb').then((res) =>
	res.text().then((text) => console.log("A", text))
)
