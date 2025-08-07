import { Elysia, t } from '../src'

const app = new Elysia()
	.post(
		'/',
		({ body }) => {
			return body
		},
		{
			body: t.Uint8Array({
				maxByteLength: 1
			})
		}
	)
	.listen(3000)

const response = await fetch(
	new Request('http://localhost:3000', {
		method: 'POST',
		body: new TextEncoder().encode('可愛くてごめん'),
		headers: { 'content-type': 'application/octet-stream' }
	})
)

console.log(response.headers.toJSON())
