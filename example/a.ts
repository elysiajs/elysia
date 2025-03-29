import { Elysia, t, form, file } from '../src'

const app = new Elysia()
	.get(
		'/',
		() =>
			form({
				name: 'Misono Mika',
				file: file('example/kyuukurarin.mp4')
			}),
		{
			response: t.Form({
				name: t.String(),
				file: t.File()
			})
		}
	)
	.listen(3000)

// app._routes.post.response
