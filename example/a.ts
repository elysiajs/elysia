import { Elysia, error, t } from '../src'

const app = new Elysia().post('/', ({ body }) => 'ok')

app.handle(
	new Request('http://localhost', {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		}
	})
)
	.then((x) => x.text())
	.then(console.log)
