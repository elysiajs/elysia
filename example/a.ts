import { Elysia, t } from '../src'
import html from '../example/index.html'

const app = new Elysia()
	.get(
		'/',
		({ cookie: { thing } }) => {
			console.log(typeof thing.value)

			return thing.value
		},
		{
			cookie: t.Object({
				thing: t.Number()
			})
		}
	)
	.listen(3000)

app.handle(
	new Request('http://localhost:3000/', {
		headers: {
			cookie: 'thing=9'
		}
	})
)
	.then((response) => response.json())
	.then(console.log)
