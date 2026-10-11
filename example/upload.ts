import { Elysia, t } from '../src'
import { upload } from '../test/utils'

const app = new Elysia()
	.post(
		'/single',
		{
			body: t.Object({
				file: t.File()
			})
		},
		({ body: { file } }) => file
	)
	.post(
		'/multiple',
		{
			body: t.Object({
				files: t.Files()
			})
		},
		({ body: { files } }) => files.reduce((a, b) => a + b.size, 0)
	)
	.listen(3000)

const { request } = upload('/single', {
	file: 'millenium.jpg'
})

app.handle(request)
	.then((r) => r.text())
	.then(console.log)
