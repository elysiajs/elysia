import { Elysia, t } from '../src'
import { upload } from '../test/utils'

const app = new Elysia()
	.post('/single', ({ body: { file } }) => file, {
		body: t.Object({
			file: t.File()
		})
	})
	.post(
		'/multiple',
		({ body: { files } }) => files.reduce((a, b) => a + b.size, 0),
		{
			body: t.Object({
				files: t.Files()
			})
		}
	)
	.listen(3000)

const { request } = upload('/single', {
	file: 'millenium.jpg'
})

app.handle(request)
	.then((r) => r.text())
	.then(console.log)
