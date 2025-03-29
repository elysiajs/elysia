import { Elysia, t, form, file, error } from '../src'

const app = new Elysia()
	.macro({
		a: {
			resolve() {
				return {
					a: 'b'
				}
			}
		}
	})
	.get(
		'/',
		error(418, "I'm a teapot"),
		{
			response: {
				200: t.Form({
					name: t.String(),
					file: t.File()
				}),
			}
		}
	)
	.listen(3000)

// app._routes.post.response
