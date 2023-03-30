import { Elysia, t } from '../src'

const app = new Elysia()
	.use(async (app) => app.post('/', ({ body }) => body))
	.listen(8080)

await app.modules

app.handle(
	new Request('http://localhost/', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: 'a'
	})
)
	.then((x) => x.text())
	.then(console.log)

type App = typeof app
