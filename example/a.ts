import { Elysia, t } from '../src/2'

const app = new Elysia().post(
	'/',
	({ body }) => {
		console.log(body)

		return body
	},
	{
		body: t.Object({
			name: t.String()
		})
	}
)

app.handle(
	new Request('http://localhost', {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			name: 'q'
		})
	})
)
	.then(x => x.json())
	.then(console.log)
