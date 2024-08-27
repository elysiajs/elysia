import { Elysia, t } from '../src'

const app = new Elysia({ precompile: true })
	.post(
		'/',
		({ body }) => {
			console.log(body)

			return { ok: true }
		},
		{
			type: 'multipart/form-data',
			body: t.Optional(
				t.Object({
					file: t.Optional(t.File()),
					name: t.Optional(t.String())
				})
			)
		}
	)
	.listen(3000, (server) => {
		console.log(`> App is listening at: ${server.url.origin}`)
	})

console.log(app.routes[0].composed?.toString())
