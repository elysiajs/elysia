import { Elysia, t } from '../src/2'

const q = new Elysia().post(
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
).compile()

const handler = q.routes[0].compile()

console.log(handler)

await handler({
	set: {
		status: 200,
		headers: {}
	},
	request: new Request('http://localhost', {
		method: 'GET',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			name: 'q'
		})
	})
})
	.then((res) => res.text())
	.then(console.log)
