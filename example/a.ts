import { Elysia, t, problem } from '../src'

export const app = new Elysia()
	.get(
		'/',
		{
			query: t.Object({
				name: t.String()
			})
		},
		({ query }) => query
	)
	.listen(3000)

app.handle('/')
	.then((x) => x.json())
	.then(console.log)
