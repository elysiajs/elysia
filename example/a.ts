import { Elysia, t, Context } from '../src'

const app = new Elysia()
	.setModel({
		a: t.String()
	})
	.post(
		'/',
		({ body }) => {
			console.log(typeof body)

			return body
		},
		{
			body: 'a'
		}
	)
	.listen(3000, ({ hostname, port }) => {
		console.log(`Running at http://${hostname}:${port}`)
	})
